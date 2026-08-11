import type { BookmarkRepository } from '../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../bookmarks/types';
import { redactSensitiveText } from '../ai/security/redact-sensitive';
import type { CapturePreferenceRepository } from './preference-repository';
import {
  isFixedRuleInstruction,
  preferenceFromDecision
} from './preference-repository';
import { redactUrlForModel } from './model-context';
import { assessCaptureRisk, type CaptureRiskFacts } from './risk-policy';
import type { CaptureSessionRepository } from './session-repository';
import {
  CAPTURE_SESSION_TTL_MS,
  type CaptureActivity,
  type CaptureActivityDraft,
  type CaptureAgentAction,
  type CaptureAgentBeginInput,
  type CaptureFailure,
  type CapturePlan,
  type CapturePreference,
  type CaptureRiskAssessment,
  type CaptureSession
} from './types';

export interface CapturePlannerInput {
  source: BookmarkNode & { url: string };
  page?: CaptureAgentBeginInput['page'];
  preferences: CapturePreference[];
  reportActivity?: (activity: CaptureActivityDraft) => Promise<void>;
}

export interface CaptureRevisionInput extends CapturePlannerInput {
  session: CaptureSession;
  message: string;
}

export interface CapturePlanner {
  plan(input: CapturePlannerInput): Promise<CapturePlan>;
  revise(input: CaptureRevisionInput): Promise<CapturePlan>;
}

export interface CaptureExecutionReceipt {
  batchId: string;
  bookmarkId: string;
}

export interface CaptureExecutor {
  stageForApproval(session: CaptureSession): Promise<{ batchId: string }>;
  execute(session: CaptureSession): Promise<CaptureExecutionReceipt>;
  undo(batchId: string): Promise<{ completed: number; failed: number }>;
}

export interface CaptureAgentDependencies {
  bookmarks: Pick<BookmarkRepository, 'get' | 'getTree'>;
  sessions: CaptureSessionRepository;
  preferences: Pick<CapturePreferenceRepository, 'listMatching' | 'put'>;
  planner: CapturePlanner;
  executor: CaptureExecutor;
  getSpecialFolderIds(): Promise<string[]>;
  onSessionChanged?: (session: CaptureSession) => void | Promise<void>;
  now?: () => number;
  createId?: () => string;
}

/**
 * Owns one complete capture decision. Callers only begin a capture or respond
 * to its current proposal; planning, risk routing, learning and execution stay
 * behind this interface.
 */
export class CaptureAgent {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly dependencies: CaptureAgentDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  async begin(input: CaptureAgentBeginInput): Promise<CaptureSession> {
    const source = await this.requireSource(input.bookmarkId);
    const timestamp = this.now();
    const session: CaptureSession = {
      id: this.createId(),
      bookmarkId: source.id,
      trigger: input.trigger,
      sourceSnapshot: source,
      state: 'analyzing',
      activities: initialActivities(input, timestamp),
      messages: [],
      pageInformation: hasPageInformation(input.page)
        ? 'sufficient'
        : 'insufficient',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + CAPTURE_SESSION_TTL_MS
    };
    await this.persist(session);
    return this.planAndRoute(session, input.page);
  }

  async respond(
    sessionId: string,
    action: CaptureAgentAction
  ): Promise<CaptureSession> {
    const session = await this.dependencies.sessions.get(sessionId);
    if (!session) throw new Error('收藏任务不存在或已被清理');

    if (action.type === 'undo') return this.undo(session);
    if (action.type === 'retry') {
      if (
        session.failure?.kind === 'network' &&
        session.failure.retryCount >= 2
      )
        throw new Error('Network retry limit reached');
      if (session.state !== 'failed') throw new Error('当前任务无需重试');
      const retrying = {
        ...session,
        state: 'analyzing' as const,
        failure: undefined,
        pageInformation: hasPageInformation(action.page)
          ? ('sufficient' as const)
          : ('insufficient' as const),
        updatedAt: this.now()
      };
      await this.persist(retrying);
      return this.planAndRoute(
        retrying,
        action.page,
        (session.failure?.retryCount ?? 0) + 1
      );
    }
    if (action.type === 'message' && session.state === 'applied') {
      const current = await this.requireSource(session.bookmarkId);
      const reopened: CaptureSession = {
        ...session,
        sourceSnapshot: current,
        state: 'adjusting',
        resolution: undefined,
        resolvedAt: undefined,
        messages: [],
        pageInformation: session.pageInformation ?? 'sufficient',
        updatedAt: this.now()
      };
      await this.persist(reopened);
      return this.revise(reopened, action.message);
    }
    if (!['pending', 'adjusting', 'ready'].includes(session.state))
      throw new Error('当前收藏任务不能再修改');

    if (action.type === 'reject') {
      const rejected = this.requireResolved(
        await this.dependencies.sessions.resolve(
          session.id,
          'rejected',
          this.now(),
          session.operationBatchId
        )
      );
      await this.notifySessionChanged(rejected);
      await this.learn(session, 'reject');
      return rejected;
    }
    if (action.type === 'message') return this.revise(session, action.message);
    if (!session.plan || !session.risk?.canExecute)
      throw new Error('当前方案无法执行，请先与 Agent 调整');
    return this.execute(session, 'allowed');
  }

  private async planAndRoute(
    session: CaptureSession,
    page?: CaptureAgentBeginInput['page'],
    retryCount = 0
  ): Promise<CaptureSession> {
    let currentSession = session;
    try {
      const preferences = await this.dependencies.preferences.listMatching(
        session.sourceSnapshot.url ?? '',
        session.sourceSnapshot.title
      );
      const plan = await this.dependencies.planner.plan({
        source: sourceForPlanner(session.sourceSnapshot),
        ...(page ? { page: pageForPlanner(page) } : {}),
        preferences,
        reportActivity: async (activity) => {
          currentSession = await this.recordActivity(currentSession, activity);
        }
      });
      currentSession = await this.recordActivity(currentSession, {
        id: 'risk-check',
        kind: 'risk',
        status: 'running',
        label: '正在检查风险',
        facts: [
          { label: '建议位置', value: planDestinationLabel(plan) },
          { label: '置信度', value: confidenceLabel(plan.confidence) }
        ]
      });
      const risk = await this.assess(currentSession, plan, page);
      currentSession = await this.recordActivity(currentSession, {
        id: 'risk-check',
        kind: 'risk',
        status: 'completed',
        label: '风险检查完成',
        detail: riskActivityDetail(risk.reasons),
        facts: [
          {
            label: '审批结论',
            value:
              risk.decision === 'auto' && risk.canExecute
                ? '安全方案，可自动执行'
                : '风险方案，需要用户批准'
          },
          {
            label: '命中规则',
            value:
              risk.reasons.length > 0
                ? risk.reasons.map(riskReasonLabel).join('、')
                : '无'
          }
        ]
      });
      const ready: CaptureSession = {
        ...currentSession,
        state: 'ready',
        plan,
        risk,
        failure: undefined,
        updatedAt: this.now()
      };
      await this.persist(ready);
      if (risk.decision === 'auto' && risk.canExecute)
        return this.execute(ready, 'auto');
      const staged = await this.dependencies.executor.stageForApproval(ready);
      const stagedSource = await this.dependencies.bookmarks.get(
        ready.bookmarkId
      );
      const pending: CaptureSession = {
        ...ready,
        state: 'pending',
        sourceSnapshot:
          stagedSource && isBookmark(stagedSource)
            ? stagedSource
            : ready.sourceSnapshot,
        stagingBatchId: staged.batchId,
        updatedAt: this.now()
      };
      await this.persist(pending);
      return pending;
    } catch (error) {
      const failed: CaptureSession = {
        ...failRunningActivities(currentSession, this.now()),
        state: 'failed',
        failure: failureFrom(error, retryCount),
        updatedAt: this.now()
      };
      await this.persist(failed);
      return failed;
    }
  }

  private async revise(
    session: CaptureSession,
    rawMessage: string
  ): Promise<CaptureSession> {
    const message = rawMessage.trim().slice(0, 2_000);
    if (!message) throw new Error('请输入要调整的内容');
    const timestamp = this.now();
    const withUserMessage = await this.dependencies.sessions.appendMessage(
      session.id,
      {
        id: this.createId(),
        role: 'user',
        text: message,
        createdAt: timestamp
      }
    );
    await this.notifySessionChanged(withUserMessage);
    let currentSession = withUserMessage;
    try {
      const preferences = await this.dependencies.preferences.listMatching(
        session.sourceSnapshot.url ?? '',
        session.sourceSnapshot.title
      );
      const plan = await this.dependencies.planner.revise({
        source: sourceForPlanner(session.sourceSnapshot),
        session: sessionForPlanner(withUserMessage),
        message,
        preferences,
        reportActivity: async (activity) => {
          currentSession = await this.recordActivity(currentSession, activity);
        }
      });
      const revisionNumber = userMessageCount(withUserMessage);
      currentSession = await this.recordActivity(currentSession, {
        id: `risk-check-revision-${revisionNumber}`,
        kind: 'risk',
        status: 'running',
        label: '正在复核调整后的风险',
        facts: [{ label: '建议位置', value: planDestinationLabel(plan) }]
      });
      const risk = await this.assess(currentSession, plan);
      currentSession = await this.recordActivity(currentSession, {
        id: `risk-check-revision-${revisionNumber}`,
        kind: 'risk',
        status: 'completed',
        label: '调整方案风险复核完成',
        detail: riskActivityDetail(risk.reasons),
        facts: [
          {
            label: '命中规则',
            value:
              risk.reasons.length > 0
                ? risk.reasons.map(riskReasonLabel).join('、')
                : '无'
          }
        ]
      });
      const withAssistantMessage =
        await this.dependencies.sessions.appendMessage(session.id, {
          id: this.createId(),
          role: 'assistant',
          text: plan.reason || '方案已调整',
          createdAt: this.now()
        });
      await this.notifySessionChanged(withAssistantMessage);
      const pending: CaptureSession = {
        ...withAssistantMessage,
        state: 'pending',
        plan,
        risk,
        updatedAt: this.now()
      };
      await this.persist(pending);
      return pending;
    } catch (error) {
      const failed: CaptureSession = {
        ...failRunningActivities(currentSession, this.now()),
        state: 'failed',
        failure: failureFrom(error),
        updatedAt: this.now()
      };
      await this.persist(failed);
      return failed;
    }
  }

  private async execute(
    session: CaptureSession,
    resolution: 'auto' | 'allowed'
  ): Promise<CaptureSession> {
    let currentSession = session;
    try {
      currentSession = await this.recordActivity(currentSession, {
        id: 'execution',
        kind: 'execution',
        status: 'running',
        label: '正在执行前安全复核',
        facts: [
          { label: '写入方式', value: '仅使用本地书签接口' },
          {
            label: '方案范围',
            value: executionScopeLabel(currentSession.plan)
          }
        ]
      });
      const currentRisk = currentSession.plan
        ? await this.assess(currentSession, currentSession.plan)
        : undefined;
      if (!currentSession.plan || !currentRisk?.canExecute)
        throw new Error('书签或目录已发生变化，请重新分析');
      const executing: CaptureSession = {
        ...currentSession,
        state: 'executing',
        risk: currentRisk,
        updatedAt: this.now()
      };
      currentSession = await this.persist(executing);
      currentSession = await this.recordActivity(currentSession, {
        id: 'execution',
        kind: 'execution',
        status: 'running',
        label: '正在整理书签',
        detail: '仅执行已通过风险检查的本地书签操作',
        facts: currentSession.plan
          ? [
              {
                label: '目标目录',
                value: planDestinationLabel(currentSession.plan)
              },
              {
                label: '新建目录',
                value:
                  currentSession.plan.destination.newFolders.length > 0
                    ? currentSession.plan.destination.newFolders.join(' / ')
                    : '无'
              }
            ]
          : undefined
      });
      const receipt = await this.dependencies.executor.execute(currentSession);
      if (receipt.bookmarkId !== session.bookmarkId) {
        currentSession = await this.persist({
          ...currentSession,
          bookmarkId: receipt.bookmarkId,
          updatedAt: this.now()
        });
      }
      currentSession = await this.recordActivity(currentSession, {
        id: 'execution',
        kind: 'execution',
        status: 'completed',
        label: '书签整理完成',
        detail: '标题与收藏位置已按最终方案更新',
        facts: currentSession.plan
          ? [
              {
                label: '最终位置',
                value: planDestinationLabel(currentSession.plan)
              },
              {
                label: '标题处理',
                value:
                  currentSession.plan.title ===
                  currentSession.sourceSnapshot.title
                    ? '保留原标题'
                    : '已采用建议标题'
              }
            ]
          : undefined
      });
      const applied = this.requireResolved(
        await this.dependencies.sessions.resolve(
          session.id,
          resolution,
          this.now(),
          receipt.batchId
        )
      );
      await this.notifySessionChanged(applied);
      if (resolution === 'allowed') {
        const decision = session.messages.some(
          (message) => message.role === 'user'
        )
          ? 'agent-adjustment'
          : 'allow';
        await this.learn(session, decision);
      }
      return applied;
    } catch (error) {
      const failed: CaptureSession = {
        ...failRunningActivities(currentSession, this.now()),
        state: 'failed',
        failure: failureFrom(error),
        updatedAt: this.now()
      };
      await this.persist(failed);
      return failed;
    }
  }

  private async undo(session: CaptureSession): Promise<CaptureSession> {
    if (session.state !== 'applied' || !session.operationBatchId)
      throw new Error('当前收藏没有可撤销的操作');
    const result = await this.dependencies.executor.undo(
      session.operationBatchId
    );
    if (result.failed > 0)
      throw new Error('部分书签已被其他操作修改，无法完整撤销');
    const undone = this.requireResolved(
      await this.dependencies.sessions.resolve(
        session.id,
        'undone',
        this.now(),
        session.operationBatchId
      )
    );
    await this.notifySessionChanged(undone);
    return undone;
  }

  private async recordActivity(
    session: CaptureSession,
    draft: CaptureActivityDraft
  ): Promise<CaptureSession> {
    const timestamp = this.now();
    const safeDraft = sanitizeActivityDraft(draft);
    const existingIndex = session.activities.findIndex(
      (activity) => activity.id === safeDraft.id
    );
    const existing = session.activities[existingIndex];
    const activity: CaptureActivity = {
      ...safeDraft,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(safeDraft.status === 'running'
        ? {}
        : {
            durationMs: Math.max(
              0,
              timestamp - (existing?.createdAt ?? timestamp)
            )
          })
    };
    const activities = [...session.activities];
    if (existingIndex >= 0) activities[existingIndex] = activity;
    else activities.push(activity);
    return this.persist({
      ...session,
      activities,
      updatedAt: timestamp
    });
  }

  private async persist(session: CaptureSession): Promise<CaptureSession> {
    await this.dependencies.sessions.put(session);
    await this.notifySessionChanged(session);
    return session;
  }

  private async notifySessionChanged(session: CaptureSession): Promise<void> {
    try {
      await this.dependencies.onSessionChanged?.(session);
    } catch {
      // UI publication is best-effort and must not change the bookmark outcome.
    }
  }

  private async assess(
    session: CaptureSession,
    plan: CapturePlan,
    page?: CaptureAgentBeginInput['page']
  ) {
    const [current, nodes, specialFolderIds] = await Promise.all([
      this.dependencies.bookmarks.get(session.bookmarkId),
      this.dependencies.bookmarks.getTree(),
      this.dependencies.getSpecialFolderIds()
    ]);
    const destination = nodes.find(
      (node) => node.id === plan.destination.folderId && !isBookmark(node)
    );
    const relatedKinds = new Set(
      plan.relatedBookmarks.map((bookmark) => bookmark.relation)
    );
    const facts: CaptureRiskFacts = {
      destination: !destination
        ? 'unclear'
        : plan.destination.newFolders.length > 0
          ? 'new'
          : 'existing',
      newFolderCount: plan.destination.newFolders.length,
      creationSource: plan.destination.creationSource,
      maxNewFolderLevels: plan.destination.maxNewFolderLevels,
      confidence: plan.confidence,
      duplicate: relatedKinds.has('exact')
        ? 'exact'
        : relatedKinds.has('similar')
          ? 'similar'
          : 'none',
      ruleConflict: plan.riskHints?.ruleConflict === true,
      sourceTitle: session.sourceSnapshot.title,
      proposedTitle: plan.title,
      titleMeaningPreserved:
        plan.riskHints?.titleMeaningPreserved === false ? false : undefined,
      destinationIsSpecial: specialFolderIds.includes(
        plan.destination.folderId
      ),
      pageInformation:
        plan.riskHints?.pageInformation === 'insufficient' ||
        (session.pageInformation ??
          (hasPageInformation(page) ? 'sufficient' : 'insufficient')) ===
          'insufficient'
          ? 'insufficient'
          : 'sufficient',
      sourceCurrent: sameSource(current, session.sourceSnapshot),
      treeCurrent: Boolean(destination)
    };
    return assessCaptureRisk(facts);
  }

  private async learn(
    session: CaptureSession,
    decision: 'allow' | 'reject' | 'agent-adjustment'
  ) {
    const explicitRule = session.messages.some(
      (message) =>
        message.role === 'user' && isFixedRuleInstruction(message.text)
    );
    const preference = preferenceFromDecision({
      id: this.createId(),
      session,
      decision,
      explicitRule,
      createdAt: this.now()
    });
    if (!preference) return;
    try {
      await this.dependencies.preferences.put(preference);
    } catch {
      // Learning is advisory and must not roll back a bookmark decision.
    }
  }

  private async requireSource(
    bookmarkId: string
  ): Promise<BookmarkNode & { url: string }> {
    const bookmark = await this.dependencies.bookmarks.get(bookmarkId);
    if (!bookmark || !isBookmark(bookmark)) throw new Error('收藏的书签不存在');
    return bookmark;
  }

  private requireResolved(session: CaptureSession | null): CaptureSession {
    if (!session) throw new Error('收藏任务不存在或已被清理');
    return session;
  }
}

function sameSource(
  current: BookmarkNode | null,
  source: BookmarkNode
): boolean {
  return Boolean(
    current &&
    current.id === source.id &&
    current.parentId === source.parentId &&
    current.index === source.index &&
    current.title === source.title &&
    current.url === source.url
  );
}

function failureFrom(error: unknown, retryCount = 0): CaptureFailure {
  const message =
    error instanceof Error ? error.message : '收藏 Agent 处理失败';
  const normalized =
    `${error instanceof Error ? error.name : ''} ${message}`.toLocaleLowerCase();
  if (/schema|json|parse|validation|结构/.test(normalized))
    return { kind: 'schema', message, retryable: false, retryCount };
  if (/profile|model|api key|配置|模型/.test(normalized))
    return {
      kind: 'configuration',
      message,
      retryable: false,
      retryCount
    };
  if (/fetch|network|timeout|timed out|网络/.test(normalized))
    return { kind: 'network', message, retryable: true, retryCount };
  if (/conflict|变化|stale|不存在/.test(normalized))
    return { kind: 'conflict', message, retryable: false, retryCount };
  return { kind: 'unknown', message, retryable: false, retryCount };
}

function hasPageInformation(
  page: CaptureAgentBeginInput['page'] | undefined
): boolean {
  return Boolean(
    page?.description?.trim() ||
    page?.text?.trim() ||
    validImageDataUrl(page?.imageDataUrl)
  );
}

function sourceForPlanner(
  source: BookmarkNode
): BookmarkNode & { url: string } {
  if (!isBookmark(source)) throw new Error('Bookmark source is unavailable');
  return { ...source, url: redactUrlForModel(source.url) };
}

function sessionForPlanner(session: CaptureSession): CaptureSession {
  return {
    ...session,
    sourceSnapshot: isBookmark(session.sourceSnapshot)
      ? sourceForPlanner(session.sourceSnapshot)
      : session.sourceSnapshot,
    plan: session.plan
      ? {
          ...session.plan,
          relatedBookmarks: session.plan.relatedBookmarks.map((bookmark) => ({
            ...bookmark,
            url: redactUrlForModel(bookmark.url)
          }))
        }
      : undefined
  };
}

function pageForPlanner(
  page: NonNullable<CaptureAgentBeginInput['page']>
): NonNullable<CaptureAgentBeginInput['page']> {
  return {
    ...(page.description
      ? { description: page.description.slice(0, 500) }
      : {}),
    ...(page.text ? { text: page.text.slice(0, 6_000) } : {}),
    ...(validImageDataUrl(page.imageDataUrl)
      ? { imageDataUrl: page.imageDataUrl }
      : {})
  };
}

function validImageDataUrl(value: string | undefined): boolean {
  return Boolean(
    value &&
    value.length <= 3_000_000 &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)
  );
}

function initialActivities(
  input: CaptureAgentBeginInput,
  timestamp: number
): CaptureActivity[] {
  const hasPage = hasPageInformation(input.page);
  return [
    {
      id: 'capture',
      kind: 'capture',
      status: 'completed',
      label: '原生书签已保存',
      detail: '收藏先保存在浏览器中，分析失败也不会丢失',
      facts: [
        { label: '触发入口', value: triggerLabel(input.trigger) },
        { label: '保存顺序', value: '先保存，再分析' }
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      durationMs: 0
    },
    {
      id: 'page-context',
      kind: 'page',
      status: hasPage ? 'completed' : 'skipped',
      label: hasPage ? '页面上下文已准备' : '未读取到页面正文',
      detail: hasPage
        ? '已提取标题、描述与正文用于本次归类'
        : '将仅根据书签标题与网址判断',
      facts: [
        {
          label: '描述',
          value: `${Array.from(input.page?.description?.trim() ?? '').length} 字符`
        },
        {
          label: '正文',
          value: `${Array.from(input.page?.text?.trim() ?? '').length} 字符`
        },
        {
          label: '页面截图',
          value: validImageDataUrl(input.page?.imageDataUrl)
            ? '当前可见区域已准备'
            : '未提供'
        },
        { label: '隐私处理', value: '网址参数在发送前移除' }
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      durationMs: 0
    }
  ];
}

function sanitizeActivityDraft(
  draft: CaptureActivityDraft
): CaptureActivityDraft {
  const label = safeAuditText(draft.label, 120) || 'Agent 步骤';
  const detail = draft.detail ? safeAuditText(draft.detail, 500) : undefined;
  const facts = draft.facts
    ?.slice(0, 6)
    .map((fact) => ({
      label: safeAuditText(fact.label, 40),
      value: safeAuditText(fact.value, 180)
    }))
    .filter((fact) => fact.label && fact.value);
  return {
    id: draft.id.slice(0, 120),
    kind: draft.kind,
    status: draft.status,
    label,
    ...(detail ? { detail } : {}),
    ...(facts?.length ? { facts } : {})
  };
}

function safeAuditText(value: string, limit: number): string {
  const redacted = redactSensitiveText(value).replace(
    /https?:\/\/[^\s<>"']+/gi,
    (url) => redactUrlForModel(url)
  );
  return Array.from(redacted.trim()).slice(0, limit).join('');
}

function riskActivityDetail(reasons: CaptureRiskAssessment['reasons']): string {
  return reasons.length > 0
    ? `发现 ${reasons.length} 项需要批准的风险`
    : '未发现需要批准的风险';
}

function triggerLabel(trigger: CaptureAgentBeginInput['trigger']): string {
  if (trigger === 'native-bookmark') return '浏览器原生收藏';
  if (trigger === 'keyboard-command') return '扩展快捷键';
  if (trigger === 'context-menu') return '网页右键菜单';
  return '扩展收藏入口';
}

function confidenceLabel(confidence: CapturePlan['confidence']): string {
  if (confidence === 'high') return '高';
  if (confidence === 'medium') return '中';
  if (confidence === 'low') return '低';
  return '未知';
}

function planDestinationLabel(plan: CapturePlan): string {
  return [
    ...plan.destination.path.map((folder) => folder.title),
    ...plan.destination.newFolders
  ]
    .filter(Boolean)
    .join(' / ') || '书签栏';
}

function executionScopeLabel(plan: CapturePlan | undefined): string {
  if (!plan) return '方案不可用';
  const operations = ['移动书签', '更新元数据'];
  if (plan.title) operations.push('检查标题');
  if (plan.destination.newFolders.length > 0) operations.push('创建目录');
  if (plan.relatedBookmarks.some((bookmark) => bookmark.relation === 'exact'))
    operations.push('处理精确重复');
  return operations.join('、');
}

function riskReasonLabel(reason: CaptureRiskAssessment['reasons'][number]): string {
  const labels: Record<
    CaptureRiskAssessment['reasons'][number],
    string
  > = {
    'new-folder': '新建目录',
    'multi-level-folder-creation': '多级目录',
    'unclear-destination': '目标不明确',
    'low-confidence': '置信度不足',
    'exact-duplicate': '相同网址',
    'similar-bookmark': '相似收藏',
    'rule-conflict': '规则冲突',
    'large-title-change': '标题变化较大',
    'special-folder': '特殊目录',
    'insufficient-page-information': '页面信息不足',
    'stale-state': '状态已变化'
  };
  return labels[reason];
}

function userMessageCount(session: CaptureSession): number {
  return session.messages.filter((message) => message.role === 'user').length;
}

function failRunningActivities(
  session: CaptureSession,
  timestamp: number
): CaptureSession {
  return {
    ...session,
    activities: session.activities.map((activity) =>
      activity.status === 'running'
        ? {
            ...activity,
            status: 'failed',
            label: failedActivityLabel(activity),
            detail: '此步骤未完成，可在修复问题后重试',
            updatedAt: timestamp
          }
        : activity
    )
  };
}

function failedActivityLabel(activity: CaptureActivity): string {
  if (activity.kind === 'model') return 'AI 方案生成未完成';
  if (activity.kind === 'folders') return '候选目录比较未完成';
  if (activity.kind === 'risk') return '风险检查未完成';
  if (activity.kind === 'execution') return '书签整理未完成';
  return `${activity.label.replace(/^正在/, '')}未完成`;
}
