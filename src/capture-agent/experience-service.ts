import type { BookmarkRepository } from '../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../bookmarks/types';
import { redactSensitiveText } from '../ai/security/redact-sensitive';
import { tokenize } from '../search/tokenize';
import type { ChromeSettingsRepository } from '../settings/settings-repository';
import type { SiftmarkDatabase } from '../storage/database';
import type { CapturePreferenceRecord } from '../storage/schema';
import { DexieCaptureSessionRepository } from './session-repository';
import type { CaptureLearningMemory, CapturePreference, CaptureSession } from './types';

const DAY = 86_400_000;
const EVIDENCE_TTL = 30 * DAY;
const MEMORY_TTL = 90 * DAY;
const REVIEW_INTERVAL = 12 * 60 * 60 * 1_000;
const MAX_EVIDENCE = 500;
const MAX_PLANS = 3;

export interface ExperienceEvent {
  id: string;
  bookmarkId: string;
  kind: NonNullable<CapturePreference['observationKind']>;
  folderId?: string;
  query?: string;
  occurredAt: number;
}

/** 只保存操作证据和原生书签引用，不保存网页正文、提示词或另一份书签库。 */
export class AgentExperienceService {
  constructor(
    private readonly database: SiftmarkDatabase,
    private readonly settings: ChromeSettingsRepository,
    private readonly bookmarks: Pick<BookmarkRepository, 'getTree'>,
    private readonly now: () => number = Date.now
  ) {}

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    // 所有窗口和 MV3 后台共用锁；关闭、清空与迟到的反馈不能交错写入。
    return await navigator.locks.request('siftmark-agent-learning', action);
  }

  configure(enabled: boolean, proactive: boolean): Promise<void> {
    return this.locked(async () => {
      const previous = await this.settings.getAgentLearningSettings();
      await this.settings.setAgentLearningSettings({
        ...previous, enabled, proactive: enabled && proactive,
        ...(enabled !== previous.enabled ? {
          since: this.now(), generation: previous.generation + 1
        } : {})
      });
      const review = await this.settings.getSleepReviewSettings();
      await this.settings.setSleepReviewSettings({ ...review, enabled: enabled && proactive });
    });
  }

  async observeSession(session: CaptureSession): Promise<void> {
    if (!session.plan || !session.resolvedAt || session.resolution === 'auto') return;
    const kind = session.resolution === 'allowed'
      ? session.messages.some((message) => message.role === 'user') ? 'adjust' : 'allow'
      : session.resolution === 'rejected' ? 'reject'
        : session.resolution === 'undone' ? 'undo' : undefined;
    if (!kind) return;
    await this.observe({
      id: `capture:${session.id}`, bookmarkId: session.bookmarkId, kind,
      folderId: session.plan.destination.folderId, occurredAt: session.resolvedAt
    }, session.createdAt);
  }

  observe(event: ExperienceEvent, taskStartedAt = event.occurredAt): Promise<void> {
    return this.locked(async () => {
      const config = await this.settings.getAgentLearningSettings();
      if (!config.enabled || taskStartedAt < config.since || event.occurredAt < config.since || event.occurredAt < this.now() - EVIDENCE_TTL) return;
      if (!event.id || event.id.length > 240 || !Number.isFinite(event.occurredAt) ||
        !['allow', 'reject', 'adjust', 'undo', 'move', 'search'].includes(event.kind)) return;
      const nodes = await this.bookmarks.getTree();
      const bookmark = nodes.find((node) => node.id === event.bookmarkId && isBookmark(node));
      if (!bookmark?.url || !/^https?:\/\//i.test(bookmark.url)) return;
      const domain = new URL(bookmark.url).hostname.toLocaleLowerCase();
      const negative = event.kind === 'reject' || event.kind === 'undo';
      const folderId = negative ? event.folderId : bookmark.parentId;
      const path = folderPath(folderId ?? '', nodes);
      if (!path || await this.isExcluded(folderId ?? '', nodes)) return;
      const safeQuery = redactSensitiveText((event.query ?? '').slice(0, 200));
      const queryTokens = event.kind === 'search' && !safeQuery.includes('[REDACTED')
        ? tokenize(safeQuery).filter((token) => token.length <= 32).slice(0, 6) : [];
      if (event.kind === 'search' && queryTokens.length === 0) return;
      const id = `experience:${config.generation}:${event.id}`;
      const existing = await this.database.capturePreferences.get(id);
      if (existing && existing.updatedAt >= event.occurredAt) return;
      const evidence: CapturePreference = {
        id, kind: 'soft', domain, action: negative ? 'avoid-folder' : 'prefer-folder',
        destinationFolderId: folderId, destinationPath: path,
        source: event.kind === 'search' ? 'search' : event.kind === 'move' ? 'manual-move' : 'local-feedback',
        sourceSessionId: event.id, sourceBookmarkIds: [bookmark.id], sourceEventIds: [event.id],
        observationKind: event.kind, ...(queryTokens.length ? { queryTokens } : {}),
        confidence: 'low', evidenceCount: 1, createdAt: existing?.updatedAt ?? event.occurredAt,
        updatedAt: event.occurredAt, expiresAt: this.now() + EVIDENCE_TTL
      };
      await this.database.transaction('rw', this.database.capturePreferences, async () => {
        await this.database.capturePreferences.put(toRecord(evidence));
        const records = await this.database.capturePreferences.orderBy('updatedAt').reverse().toArray();
        const observations = records.filter((record) => fromRecord(record).observationKind);
        await this.database.capturePreferences.bulkDelete(observations.filter((record, index) =>
          index >= MAX_EVIDENCE || (fromRecord(record).expiresAt ?? 0) <= this.now()
        ).map((record) => record.id));
        await this.consolidate(domain);
      });
    });
  }

  private async consolidate(domain: string): Promise<void> {
    const records = await this.database.capturePreferences.where('domain').equals(domain).toArray();
    const events = records.map(fromRecord).filter((record) => record.observationKind &&
      (record.expiresAt ?? 0) > this.now());
    // 同一书签的后续纠正替换先前选择；重复点击不构成多条独立证据。
    const latest = new Map<string, CapturePreference>();
    for (const event of events.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const key = `${event.queryTokens?.join(' ') ?? ''}:${event.sourceBookmarkIds?.[0]}`;
      if (!latest.has(key)) latest.set(key, event);
    }
    const groups = new Map<string, CapturePreference[]>();
    for (const event of latest.values()) {
      const key = `${event.queryTokens?.join(' ') ?? ''}:${event.destinationFolderId}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    for (const [key, group] of groups) {
      const id = `experience-memory:${encodeURIComponent(domain + ':' + key)}`;
      const stored = await this.database.capturePreferences.get(id);
      const previous = stored ? fromRecord(stored) : undefined;
      if (previous?.status === 'corrected') continue;
      const usable = group.filter((event) => previous?.status !== 'dismissed' || event.updatedAt > previous.updatedAt);
      const positive = usable.filter((event) => event.action === 'prefer-folder');
      const negative = usable.filter((event) => event.action === 'avoid-folder');
      const newestPositive = Math.max(0, ...positive.map((event) => event.updatedAt));
      const newestNegative = Math.max(0, ...negative.map((event) => event.updatedAt));
      const supporting = newestNegative > newestPositive
        ? negative.filter((event) => event.updatedAt > newestPositive)
        : positive.filter((event) => event.updatedAt > newestNegative);
      if (supporting.length < 2) {
        if (previous?.kind === 'learned' && previous.status !== 'dismissed')
          await this.database.capturePreferences.put(toRecord({ ...previous, status: 'conflicted', confidence: 'low',
            reviewSummary: '后续反馈与旧偏好冲突，暂停采用；请查看来源或纠正',
            sourceEventIds: [...new Set([...(previous.sourceEventIds ?? []), ...usable.map((event) => event.sourceSessionId)])].slice(-12),
            updatedAt: this.now() }));
        continue;
      }
      const source = supporting[0]!;
      const memory: CaptureLearningMemory = {
        ...source, id, kind: 'learned', source: 'local-feedback', observationKind: undefined,
        status: 'active', sourceBookmarkIds: supporting.map((event) => event.sourceBookmarkIds![0]!),
        sourceEventIds: supporting.map((event) => event.sourceSessionId),
        evidenceCount: supporting.length, confidence: supporting.length >= 3 ? 'high' : 'medium',
        reviewSummary: `${supporting.length} 个不同书签的明确${source.queryTokens ? '检索选择' : source.action === 'avoid-folder' ? '拒绝或撤销' : '确认或分类调整'}一致`,
        reviewedAt: this.now(), createdAt: previous?.createdAt ?? this.now(),
        updatedAt: Math.max(...supporting.map((event) => event.updatedAt)), expiresAt: this.now() + MEMORY_TTL
      };
      await this.database.capturePreferences.put(toRecord(memory));
    }
    // 原目录已无足够支持时，旧策略也要失效，不能遗留到下一次任务。
    for (const record of records.map(fromRecord).filter((item) => item.kind === 'learned' && item.source === 'local-feedback')) {
      if (record.status === 'corrected' || record.status === 'dismissed') continue;
      const key = `${record.queryTokens?.join(' ') ?? ''}:${record.destinationFolderId}`;
      if (!groups.has(key)) await this.database.capturePreferences.put(toRecord({ ...record, status: 'conflicted', confidence: 'low', reviewSummary: '当前有效来源不足，旧策略暂停采用' }));
    }
    const preferences = (await this.database.capturePreferences.where('domain').equals(domain).toArray()).map(fromRecord)
      .filter((record) => record.kind === 'learned' && record.action === 'prefer-folder' && record.status !== 'dismissed')
      .sort((a, b) => Number(b.status === 'corrected') - Number(a.status === 'corrected') || b.updatedAt - a.updatedAt);
    const preferredScopes = new Set<string>();
    for (const preference of preferences) {
      const scope = preference.queryTokens?.join(' ') ?? '';
      if (preferredScopes.has(scope) && preference.status !== 'corrected')
        await this.database.capturePreferences.put(toRecord({ ...preference, status: 'conflicted', confidence: 'low', reviewSummary: '近期分类选择已变化，旧策略暂停采用' }));
      else if (preference.status !== 'conflicted') preferredScopes.add(scope);
    }
  }

  async inspect() {
    const [configuration, records, nodes, sessions] = await Promise.all([
      this.settings.getAgentLearningSettings(), this.database.capturePreferences.toArray(),
      this.bookmarks.getTree(), new DexieCaptureSessionRepository(this.database).list(100)
    ]);
    return {
      configuration,
      memories: records.map(fromRecord).filter((record) => record.kind === 'learned').sort((a, b) => b.updatedAt - a.updatedAt) as CaptureLearningMemory[],
      evidenceCount: records.filter((record) => fromRecord(record).observationKind && (fromRecord(record).expiresAt ?? 0) > this.now()).length,
      folders: nodes.filter((node) => !isBookmark(node) && node.id !== '0'),
      plans: [
        ...sessions.filter((session) => session.trigger === 'learning-review' && ['pending', 'failed'].includes(session.state)),
        ...sessions.filter((session) => session.trigger === 'learning-review' && session.state === 'applied').slice(0, MAX_PLANS)
      ]
    };
  }
  async memories(query?: string): Promise<CaptureLearningMemory[]> {
    const config = await this.settings.getAgentLearningSettings();
    if (!config.enabled) return [];
    const [records, nodes] = await Promise.all([
      this.database.capturePreferences.where('kind').equals('learned').toArray(), this.bookmarks.getTree()
    ]);
    const tokens = new Set(tokenize(query ?? ''));
    const memories: CaptureLearningMemory[] = [];
    for (const record of records.map(fromRecord)) {
      if (record.status === 'dismissed' || record.status === 'conflicted' ||
        (record.expiresAt ?? record.updatedAt + MEMORY_TTL) <= this.now()) continue;
      if (record.queryTokens?.length && (!query || !record.queryTokens.every((token) => tokens.has(token)))) continue;
      if (!record.destinationFolderId || !folderPath(record.destinationFolderId, nodes) ||
        await this.isExcluded(record.destinationFolderId, nodes)) continue;
      memories.push({ ...record, destinationPath: folderPath(record.destinationFolderId, nodes)! } as CaptureLearningMemory);
    }
    return memories.sort((a, b) => Number(b.status === 'corrected') - Number(a.status === 'corrected') || b.updatedAt - a.updatedAt).slice(0, 100);
  }

  async matching(url: string): Promise<CapturePreference[]> {
    const domain = new URL(url).hostname.toLocaleLowerCase();
    return (await this.memories()).filter((memory) => memory.domain === domain && !memory.queryTokens?.length);
  }

  correct(id: string, folderId: string, action: CapturePreference['action']): Promise<void> {
    return this.locked(async () => {
      const config = await this.settings.getAgentLearningSettings();
      if (!config.enabled) throw new Error('请先启用本地学习');
      const record = await this.database.capturePreferences.get(id);
      const nodes = await this.bookmarks.getTree();
      const path = folderPath(folderId, nodes);
      if (!record || record.kind !== 'learned' || !path || await this.isExcluded(folderId, nodes) ||
        !['prefer-folder', 'avoid-folder'].includes(action)) throw new Error('记忆或目标目录已失效，请刷新');
      await this.database.capturePreferences.put(toRecord({
        ...fromRecord(record), destinationFolderId: folderId, destinationPath: path, action,
        source: 'user-correction', status: 'corrected', confidence: 'high',
        reviewSummary: '用户明确纠正；优先于自动归纳', reviewedAt: this.now(), updatedAt: this.now(), expiresAt: this.now() + MEMORY_TTL
      }));
    });
  }

  forget(id: string): Promise<void> {
    return this.locked(async () => {
      const record = await this.database.capturePreferences.get(id);
      if (!record || record.kind !== 'learned') return;
      // 只留无内容的时间水位，防止旧证据在下次恢复时复活已删除的记忆。
      await this.database.capturePreferences.put(toRecord({
        id, kind: 'soft', domain: '', action: 'prefer-folder', destinationPath: [],
        source: 'local-feedback', sourceSessionId: '', status: 'dismissed', createdAt: this.now(), updatedAt: this.now()
      }));
    });
  }

  clear(): Promise<void> {
    return this.locked(async () => {
      const config = await this.settings.getAgentLearningSettings();
      await this.settings.setAgentLearningSettings({ ...config, since: this.now(), generation: config.generation + 1 });
      await this.database.transaction('rw', this.database.capturePreferences, this.database.captureSessions, async () => {
        await this.database.capturePreferences.where('kind').anyOf('soft', 'learned').delete();
        await this.database.captureSessions.filter((record) => record.payload.trigger === 'learning-review' &&
          ['pending', 'ready', 'failed'].includes(record.state)).delete();
      });
    });
  }

  async recover(): Promise<void> {
    const sessions = await this.locked(async () => {
      await this.database.capturePreferences.filter((record) => Boolean(fromRecord(record).observationKind) && (fromRecord(record).expiresAt ?? 0) <= this.now()).delete();
      const repository = new DexieCaptureSessionRepository(this.database);
      const recovered = await repository.list(64);
      for (let index = 0; index < recovered.length; index += 1) {
        let session = recovered[index]!;
        if (session.trigger === 'learning-review' && session.state === 'pending' && session.expiresAt <= this.now()) {
          recovered[index] = (await repository.resolve(session.id, 'expired', this.now()))!;
          continue;
        }
        if (session.trigger !== 'learning-review' || session.state !== 'executing') continue;
        const batchId = `learning-execution:${session.id}`;
        const operation = await this.database.operationLog.filter((record) => record.batchId === batchId && record.bookmarkId === session.bookmarkId && record.type === 'move').first();
        const current = (await this.bookmarks.getTree()).find((node) => node.id === session.bookmarkId);
        if (operation?.undoneAt) session = (await repository.resolve(session.id, 'undone', this.now(), batchId))!;
        else if (operation && current && current.parentId === operation.after.parentId && current.index === operation.after.index)
          session = (await repository.resolve(session.id, 'allowed', this.now(), batchId))!;
        else if (!operation && current?.parentId === session.sourceSnapshot.parentId && current.index === session.sourceSnapshot.index) {
          session = { ...session, state: 'pending', updatedAt: this.now(), failure: undefined };
          await repository.put(session);
        } else {
          session = { ...session, state: 'failed', operationBatchId: operation ? batchId : undefined, updatedAt: this.now(),
            failure: { kind: 'conflict', message: '后台执行中断且原生状态已变化；可撤销已记录操作或结束方案，不会重复移动', retryable: false, retryCount: 0 } };
          await repository.put(session);
        }
        recovered[index] = session;
      }
      return recovered;
    });
    for (const session of sessions) await this.observeSession(session);
  }

  async review(force = false): Promise<{ summary: string; planned: number }> {
    await this.recover();
    return this.locked(async () => {
      const config = await this.settings.getAgentLearningSettings();
      if (!config.enabled) return { summary: '本地学习已暂停，不采集新证据', planned: 0 };
      if (!force && (!config.proactive || (config.lastReviewAt > 0 && this.now() - config.lastReviewAt < REVIEW_INTERVAL)))
        return { summary: '本轮检查已跳过：未授权主动检查或仍在 12 小时冷却期', planned: 0 };
      const [memories, nodes, special] = await Promise.all([
        this.memories(), this.bookmarks.getTree(), this.settings.getSpecialFolders()
      ]);
      const sessions = new DexieCaptureSessionRepository(this.database);
      let pending = (await sessions.listPending(100)).filter((session) => session.trigger === 'learning-review');
      if ((await sessions.listPending(100)).some((session) => session.trigger !== 'learning-review' && ['analyzing', 'adjusting', 'executing', 'ready'].includes(session.state)))
        return { summary: '有收藏任务正在运行，本轮复盘稍后重试', planned: 0 };
      for (const session of pending) {
        if (session.state !== 'pending') continue;
        const valid = memories.some((memory) => memory.action === 'prefer-folder' &&
          memory.destinationFolderId === session.plan?.destination.folderId && session.plan?.memoryInfluence?.adoptedMemoryIds.includes(memory.id));
        if (!valid) await sessions.resolve(session.id, 'ended', this.now());
      }
      pending = (await sessions.listPending(100)).filter((session) => session.trigger === 'learning-review');
      let planned = 0;
      for (const bookmark of nodes.filter(isBookmark).slice(0, 200)) {
        if (planned + pending.length >= MAX_PLANS) break;
        if (await this.isExcluded(bookmark.parentId, nodes) || !/^https?:\/\//i.test(bookmark.url)) continue;
        const memory = memories.find((candidate) => !candidate.queryTokens?.length && candidate.action === 'prefer-folder' &&
          candidate.domain === new URL(bookmark.url).hostname.toLocaleLowerCase());
        if (!memory?.destinationFolderId || memory.destinationFolderId === bookmark.parentId ||
          [special.inboxId, special.archiveId, special.recycleBinId].includes(memory.destinationFolderId)) continue;
        const id = `learning-plan:${config.generation}:${memory.id}:${memory.updatedAt}:${bookmark.id}:${bookmark.parentId}`;
        if (await sessions.get(id)) continue;
        const path = folderRefs(memory.destinationFolderId, nodes);
        const metadata = await this.database.bookmarkMetadata.get(bookmark.id);
        await sessions.put({
          id, bookmarkId: bookmark.id, sourceSnapshot: bookmark, trigger: 'learning-review', state: 'pending',
          plan: {
            destination: { folderId: memory.destinationFolderId, path, newFolders: [] },
            title: bookmark.title, tags: metadata?.tags ?? [], summary: metadata?.summary ?? '', confidence: 'medium',
            reason: `本地经验建议复核位置：${memory.reviewSummary}`, relatedBookmarks: [], generatedAt: this.now(),
            memoryInfluence: { matched: [memory], adoptedMemoryIds: [memory.id] }
          },
          risk: { decision: 'approval', reasons: ['low-confidence'], canExecute: true },
          activities: [], messages: [], createdAt: this.now(), updatedAt: this.now(), expiresAt: this.now() + 7 * DAY
        });
        planned += 1;
      }
      await this.settings.setAgentLearningSettings({ ...config, lastReviewAt: this.now() });
      const summary = `本地复盘完成：检查最多 200 个书签，生成 ${planned} 个待确认方案；没有移动书签`;
      await this.settings.setSleepReviewStatus({ state: 'reviewed', summary, lastCompletedAt: this.now(), nextEligibleAt: this.now() + REVIEW_INTERVAL });
      return { summary, planned };
    });
  }

  private async isExcluded(folderId: string, nodes: BookmarkNode[]): Promise<boolean> {
    const special = await this.settings.getSpecialFolders();
    const excluded = new Set([special.archiveId, special.recycleBinId].filter(Boolean));
    return folderRefs(folderId, nodes).some((folder) => excluded.has(folder.id));
  }
}

export function folderPath(id: string, nodes: BookmarkNode[]): string[] | null {
  const folder = nodes.find((node) => node.id === id && !isBookmark(node));
  if (!folder || folder.id === '0') return null;
  const refs = folderRefs(id, nodes);
  return refs.filter((ref) => nodes.find((node) => node.id === ref.id)?.parentId !== '0').map((ref) => ref.title);
}

function folderRefs(id: string, nodes: BookmarkNode[]): Array<{ id: string; title: string }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const refs: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  let node = byId.get(id);
  while (node && node.id !== '0' && !seen.has(node.id)) {
    seen.add(node.id); refs.unshift({ id: node.id, title: node.title }); node = byId.get(node.parentId);
  }
  return refs;
}

function toRecord(preference: CapturePreference): CapturePreferenceRecord {
  return { id: preference.id, kind: preference.kind, domain: preference.domain, updatedAt: preference.updatedAt,
    payload: preference as unknown as Record<string, unknown> };
}
function fromRecord(record: CapturePreferenceRecord): CapturePreference {
  return record.payload as unknown as CapturePreference;
}

/** 只调整原生书签的候选顺序，不生成或恢复书签。 */
export function experienceScore(node: BookmarkNode, memories: CapturePreference[], query = ''): number {
  if (!node.url) return 0;
  let domain: string;
  try { domain = new URL(node.url).hostname.toLocaleLowerCase(); } catch { return 0; }
  const tokens = new Set(tokenize(query));
  return memories.reduce((score, memory) => {
    if (memory.domain !== domain || memory.status === 'conflicted' || memory.status === 'dismissed') return score;
    if (memory.queryTokens?.length && !memory.queryTokens.every((token) => tokens.has(token))) return score;
    // 同一次检索的重复选择比跨任务的目录偏好更具体，检索时优先采用。
    return score + (memory.action === 'prefer-folder' ? 1 : -1) *
      (memory.destinationFolderId === node.parentId ? 2 : 1) * (memory.queryTokens?.length ? 4 : 1);
  }, 0);
}
