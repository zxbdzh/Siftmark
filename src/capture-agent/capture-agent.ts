import type { BookmarkRepository } from '../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../bookmarks/types';
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
  type CaptureAgentAction,
  type CaptureAgentBeginInput,
  type CaptureFailure,
  type CapturePlan,
  type CapturePreference,
  type CaptureSession
} from './types';

export interface CapturePlannerInput {
  source: BookmarkNode & { url: string };
  page?: CaptureAgentBeginInput['page'];
  preferences: CapturePreference[];
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
  preferences: Pick<
    CapturePreferenceRepository,
    'listMatching' | 'put'
  >;
  planner: CapturePlanner;
  executor: CaptureExecutor;
  getSpecialFolderIds(): Promise<string[]>;
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
      messages: [],
      pageInformation: hasPageInformation(input.page)
        ? 'sufficient'
        : 'insufficient',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + CAPTURE_SESSION_TTL_MS
    };
    await this.dependencies.sessions.put(session);
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
      await this.dependencies.sessions.put(retrying);
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
      await this.dependencies.sessions.put(reopened);
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
    try {
      const preferences = await this.dependencies.preferences.listMatching(
        session.sourceSnapshot.url ?? '',
        session.sourceSnapshot.title
      );
      const plan = await this.dependencies.planner.plan({
        source: sourceForPlanner(session.sourceSnapshot),
        ...(page ? { page: pageForPlanner(page) } : {}),
        preferences
      });
      const risk = await this.assess(session, plan, page);
      const ready: CaptureSession = {
        ...session,
        state: 'ready',
        plan,
        risk,
        failure: undefined,
        updatedAt: this.now()
      };
      await this.dependencies.sessions.put(ready);
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
      await this.dependencies.sessions.put(pending);
      return pending;
    } catch (error) {
      const failed: CaptureSession = {
        ...session,
        state: 'failed',
        failure: failureFrom(error, retryCount),
        updatedAt: this.now()
      };
      await this.dependencies.sessions.put(failed);
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
    try {
      const preferences = await this.dependencies.preferences.listMatching(
        session.sourceSnapshot.url ?? '',
        session.sourceSnapshot.title
      );
      const plan = await this.dependencies.planner.revise({
        source: sourceForPlanner(session.sourceSnapshot),
        session: sessionForPlanner(withUserMessage),
        message,
        preferences
      });
      const risk = await this.assess(withUserMessage, plan);
      const withAssistantMessage = await this.dependencies.sessions.appendMessage(
        session.id,
        {
          id: this.createId(),
          role: 'assistant',
          text: plan.reason || '方案已调整',
          createdAt: this.now()
        }
      );
      const pending: CaptureSession = {
        ...withAssistantMessage,
        state: 'pending',
        plan,
        risk,
        updatedAt: this.now()
      };
      await this.dependencies.sessions.put(pending);
      return pending;
    } catch (error) {
      const failed: CaptureSession = {
        ...withUserMessage,
        state: 'failed',
        failure: failureFrom(error),
        updatedAt: this.now()
      };
      await this.dependencies.sessions.put(failed);
      return failed;
    }
  }

  private async execute(
    session: CaptureSession,
    resolution: 'auto' | 'allowed'
  ): Promise<CaptureSession> {
    const currentRisk = session.plan
      ? await this.assess(session, session.plan)
      : undefined;
    if (!session.plan || !currentRisk?.canExecute)
      throw new Error('书签或目录已发生变化，请重新分析');
    const executing: CaptureSession = {
      ...session,
      state: 'executing',
      risk: currentRisk,
      updatedAt: this.now()
    };
    await this.dependencies.sessions.put(executing);
    try {
      const receipt = await this.dependencies.executor.execute(executing);
      if (receipt.bookmarkId !== session.bookmarkId) {
        await this.dependencies.sessions.put({
          ...executing,
          bookmarkId: receipt.bookmarkId,
          updatedAt: this.now()
        });
      }
      const applied = this.requireResolved(
        await this.dependencies.sessions.resolve(
          session.id,
          resolution,
          this.now(),
          receipt.batchId
        )
      );
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
        ...session,
        state: 'failed',
        failure: failureFrom(error),
        updatedAt: this.now()
      };
      await this.dependencies.sessions.put(failed);
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
    return this.requireResolved(
      await this.dependencies.sessions.resolve(
        session.id,
        'undone',
        this.now(),
        session.operationBatchId
      )
    );
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
  const message = error instanceof Error ? error.message : '收藏 Agent 处理失败';
  const normalized = `${error instanceof Error ? error.name : ''} ${message}`.toLocaleLowerCase();
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
  return Boolean(page?.description?.trim() || page?.text?.trim());
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
    ...(page.description ? { description: page.description.slice(0, 500) } : {}),
    ...(page.text ? { text: page.text.slice(0, 6_000) } : {})
  };
}
