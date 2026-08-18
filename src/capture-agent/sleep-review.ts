import { redactSensitiveText } from '../ai/security/redact-sensitive';
import type {
  AiCaptureReviewContext,
  AiCaptureReviewMemory,
  AiCaptureReviewResult
} from '../ai/types';
import type {
  ChromeSettingsRepository,
  SleepReviewAttemptOutcome,
  SleepReviewStatus,
  SleepReviewTrigger
} from '../settings/settings-repository';
import type { Confidence } from '../storage/types';
import type {
  CaptureLearningCommit,
  CaptureLearningRepository,
  CaptureLearningSessionReview
} from './learning-repository';
import type { CaptureLearningMemory, CaptureSession } from './types';

const MIN_REVIEW_SESSIONS = 3;
const REVIEW_COOLDOWN_MS = 12 * 60 * 60 * 1_000;

export interface CaptureMemoryReviewer {
  review(context: AiCaptureReviewContext): Promise<AiCaptureReviewResult>;
}

export interface CaptureSleepReviewDependencies {
  learning: CaptureLearningRepository;
  reviewer: CaptureMemoryReviewer;
  settings: Pick<
    ChromeSettingsRepository,
    'getSleepReviewSettings' | 'getSleepReviewStatus' | 'setSleepReviewStatus'
  >;
  hasActiveCapture(): Promise<boolean>;
  now?: () => number;
}

export type CaptureSleepReviewOutcome =
  'waiting' | 'learned' | 'reviewed' | 'skipped' | 'failed';

export interface CaptureSleepReviewResult {
  outcome: CaptureSleepReviewOutcome;
  reviewedSessions: number;
  learnedMemories: number;
  summary: string;
}

/**
 * Turns resolved capture evidence into advisory local memory. The interface
 * deliberately has no bookmark mutation dependency.
 */
export class CaptureSleepReviewService {
  private readonly now: () => number;
  private running?: Promise<CaptureSleepReviewResult>;

  constructor(private readonly dependencies: CaptureSleepReviewDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  review(
    options: { force?: boolean; trigger?: SleepReviewTrigger } = {}
  ): Promise<CaptureSleepReviewResult> {
    if (this.running) return this.running;
    this.running = this.run(options).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(options: {
    force?: boolean;
    trigger?: SleepReviewTrigger;
  }): Promise<CaptureSleepReviewResult> {
    const configuration =
      await this.dependencies.settings.getSleepReviewSettings();
    if (!configuration.enabled) return skippedResult('睡眠回顾尚未启用');
    const trigger = options.trigger ?? (options.force ? 'manual' : 'alarm');
    const attempt = {
      lastTrigger: trigger,
      lastAttemptAt: this.now()
    } as const;
    if (await this.dependencies.hasActiveCapture()) {
      const previous = await this.dependencies.settings.getSleepReviewStatus();
      const summary = '有收藏正在分析或执行，稍后再回顾';
      await this.dependencies.settings.setSleepReviewStatus(
        statusWithAttempt(previous, attempt, 'skipped', summary)
      );
      return skippedResult(summary);
    }

    const now = attempt.lastAttemptAt;
    const previous = await this.dependencies.settings.getSleepReviewStatus();
    if (
      !options.force &&
      (previous.nextEligibleAt || previous.lastCompletedAt) &&
      now <
        (previous.nextEligibleAt ??
          (previous.lastCompletedAt ?? 0) + REVIEW_COOLDOWN_MS)
    ) {
      const summary = '距离上次回顾不足 12 小时';
      await this.dependencies.settings.setSleepReviewStatus(
        statusWithAttempt(previous, attempt, 'skipped', summary)
      );
      return skippedResult(summary);
    }

    const newSessions = await this.dependencies.learning.listUnreviewed(
      configuration.batchSize
    );
    if (newSessions.length < MIN_REVIEW_SESSIONS) {
      const summary = `已积累 ${newSessions.length} / ${MIN_REVIEW_SESSIONS} 个新结果`;
      await this.dependencies.settings.setSleepReviewStatus(
        statusWithAttempt(previous, attempt, 'waiting', summary, {
          pendingSessions: newSessions.length
        })
      );
      return {
        outcome: 'waiting',
        reviewedSessions: 0,
        learnedMemories: 0,
        summary
      };
    }

    const candidatePool = await this.dependencies.learning.listReviewCandidates(
      Math.max(configuration.batchSize * 8, 64)
    );
    const sessions = selectReviewBatch(
      candidatePool,
      new Set(newSessions.map((session) => session.id)),
      configuration.batchSize
    );
    if (!hasStableEvidence(sessions)) {
      const reviews = reviewsForSessions(newSessions, []);
      await this.dependencies.learning.commit({
        memories: [],
        reviews,
        reviewedAt: now
      });
      const summary = `已整理 ${newSessions.length} 个新结果，保留候选证据等待后续确认`;
      await this.dependencies.settings.setSleepReviewStatus(
        statusWithAttempt(previous, attempt, 'reviewed', summary, {
          lastStartedAt: now,
          lastCompletedAt: now,
          nextEligibleAt: now + REVIEW_COOLDOWN_MS,
          pendingSessions: 0,
          reviewedSessions: newSessions.length,
          learnedMemories: 0
        })
      );
      return {
        outcome: 'reviewed',
        reviewedSessions: newSessions.length,
        learnedMemories: 0,
        summary
      };
    }

    await this.dependencies.settings.setSleepReviewStatus({
      ...previous,
      state: 'running',
      ...attempt,
      lastStartedAt: now,
      pendingSessions: sessions.length,
      summary: `正在回顾 ${sessions.length} 个收藏结果`
    });
    try {
      const reviewed = await this.dependencies.reviewer.review({
        examples: sessions.map(toReviewExample)
      });
      const memories = await this.acceptMemories(
        reviewed.memories,
        sessions,
        now
      );
      const commit: CaptureLearningCommit = {
        memories,
        reviews: reviewsForSessions(sessions, memories),
        reviewedAt: now
      };
      await this.dependencies.learning.commit(commit);
      const reviewedNewSessions = sessions.filter((session) =>
        newSessions.some((candidate) => candidate.id === session.id)
      ).length;
      const outcome = memories.length > 0 ? 'learned' : 'reviewed';
      const summary =
        safeText(reviewed.reviewSummary, 240) ||
        (memories.length > 0
          ? `从 ${sessions.length} 个结果中整理出 ${memories.length} 条记忆`
          : `已回顾 ${sessions.length} 个结果，暂未发现稳定规律`);
      await this.dependencies.settings.setSleepReviewStatus(
        statusWithAttempt(previous, attempt, outcome, summary, {
          lastStartedAt: now,
          lastCompletedAt: now,
          nextEligibleAt: now + REVIEW_COOLDOWN_MS,
          pendingSessions: Math.max(
            0,
            newSessions.length - reviewedNewSessions
          ),
          reviewedSessions: sessions.length,
          learnedMemories: memories.length
        })
      );
      return {
        outcome,
        reviewedSessions: sessions.length,
        learnedMemories: memories.length,
        summary
      };
    } catch (error) {
      const message = safeText(
        error instanceof Error ? error.message : '睡眠回顾失败',
        240
      );
      await this.dependencies.settings.setSleepReviewStatus(
        statusWithAttempt(
          previous,
          attempt,
          'failed',
          '本次没有更新学习记忆，稍后可以重试',
          {
            lastStartedAt: now,
            lastCompletedAt: now,
            nextEligibleAt: now + 60 * 60 * 1_000,
            pendingSessions: sessions.length,
            reviewedSessions: 0,
            learnedMemories: 0,
            error: message
          }
        )
      );
      return {
        outcome: 'failed',
        reviewedSessions: 0,
        learnedMemories: 0,
        summary: message
      };
    }
  }

  private async acceptMemories(
    proposed: AiCaptureReviewMemory[],
    sessions: CaptureSession[],
    now: number
  ): Promise<CaptureLearningMemory[]> {
    const byDomain = groupSessionsByDomain(sessions);
    const accepted: CaptureLearningMemory[] = [];
    const seenDomains = new Set<string>();
    for (const proposal of proposed.slice(0, 8)) {
      const domain = proposal.domain.trim().toLocaleLowerCase();
      const evidence = byDomain.get(domain);
      if (!evidence || seenDomains.has(domain)) continue;
      const supporting = evidence.filter((session) =>
        supportsAction(session, proposal.action)
      );
      const proposalPath = logicalLearningPath(proposal.destinationPath);
      const pathKey = normalizePath(proposalPath);
      const matching = supporting.filter(
        (session) => normalizePath(destinationPath(session)) === pathKey
      );
      if (matching.length < 2) continue;
      seenDomains.add(domain);
      const legacyId = `sleep-review:${domain}`;
      const scopedId = memoryIdFor(domain, proposal.action, pathKey);
      const [legacy, scoped] = await Promise.all([
        this.dependencies.learning.getMemory(legacyId),
        this.dependencies.learning.getMemory(scopedId)
      ]);
      const legacyMatches = Boolean(
        legacy &&
        legacy.action === proposal.action &&
        normalizeLearningPath(legacy.destinationPath) === pathKey
      );
      const id = scoped
        ? scopedId
        : !legacy || legacyMatches
          ? legacyId
          : scopedId;
      const existing = scoped ?? (legacyMatches ? legacy : null);
      const sameMemory = Boolean(
        existing &&
        existing.action === proposal.action &&
        normalizeLearningPath(existing.destinationPath) === pathKey
      );
      const latest = [...matching].sort(
        (left, right) =>
          (right.resolvedAt ?? right.updatedAt) -
          (left.resolvedAt ?? left.updatedAt)
      )[0]!;
      const exactFolder = matching.find(
        (session) => session.plan?.destination.newFolders.length === 0
      );
      accepted.push({
        id,
        kind: 'learned',
        domain,
        action: proposal.action,
        ...(exactFolder?.plan
          ? { destinationFolderId: exactFolder.plan.destination.folderId }
          : {}),
        destinationPath: proposalPath.map((part) => part.trim()),
        source: 'sleep-review',
        sourceSessionId: latest.id,
        reviewSummary: safeText(proposal.summary, 160),
        evidenceCount:
          (sameMemory ? (existing?.evidenceCount ?? 0) : 0) + matching.length,
        confidence: capConfidence(proposal.confidence, matching),
        reviewedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
    }
    return accepted;
  }
}

function statusWithAttempt(
  previous: SleepReviewStatus,
  attempt: { lastTrigger: SleepReviewTrigger; lastAttemptAt: number },
  outcome: SleepReviewAttemptOutcome,
  summary: string,
  details: Partial<SleepReviewStatus> = {}
): SleepReviewStatus {
  const nextAttempt = {
    trigger: attempt.lastTrigger,
    attemptedAt: attempt.lastAttemptAt,
    outcome,
    summary,
    reviewedSessions: details.reviewedSessions ?? 0,
    learnedMemories: details.learnedMemories ?? 0
  };
  const attempts = previous.attempts ?? [];
  const last = attempts.at(-1);
  const sameAsLast = Boolean(
    last &&
    last.trigger === nextAttempt.trigger &&
    last.outcome === nextAttempt.outcome &&
    last.summary === nextAttempt.summary
  );
  const nextAttempts = sameAsLast
    ? [...attempts.slice(0, -1), nextAttempt]
    : [...attempts, nextAttempt];
  return {
    ...previous,
    ...details,
    ...attempt,
    state: outcome,
    summary,
    error: details.error,
    attempts: nextAttempts.slice(-8)
  };
}

function toReviewExample(session: CaptureSession) {
  const plan = session.plan!;
  return {
    sessionId: session.id,
    domain: domainOf(session.sourceSnapshot.url ?? ''),
    title: safeText(session.sourceSnapshot.title, 160),
    destinationPath: destinationPath(session),
    resolution: session.resolution as
      'auto' | 'allowed' | 'rejected' | 'undone',
    tags: plan.tags.slice(0, 8).map((tag) => safeText(tag, 32)),
    summary: safeText(plan.summary, 240),
    confidence:
      plan.confidence === 'unknown' ? ('low' as const) : plan.confidence,
    reason: safeText(plan.reason, 120)
  };
}

function groupSessionsByDomain(
  sessions: CaptureSession[]
): Map<string, CaptureSession[]> {
  const groups = new Map<string, CaptureSession[]>();
  for (const session of sessions) {
    const domain = domainOf(session.sourceSnapshot.url ?? '');
    if (!domain) continue;
    groups.set(domain, [...(groups.get(domain) ?? []), session]);
  }
  return groups;
}

function selectReviewBatch(
  candidates: CaptureSession[],
  newSessionIds: Set<string>,
  limit: number
): CaptureSession[] {
  const groups = new Map<string, CaptureSession[]>();
  for (const session of candidates) {
    const signature = evidenceSignature(session);
    if (!signature) continue;
    groups.set(signature, [...(groups.get(signature) ?? []), session]);
  }
  const stableGroups = [...groups.values()]
    .filter(
      (group) =>
        group.length >= 2 &&
        group.some((session) => newSessionIds.has(session.id))
    )
    .sort(
      (left, right) =>
        right.length - left.length || latestAt(right) - latestAt(left)
    );
  const selected: CaptureSession[] = [];
  const selectedIds = new Set<string>();
  for (const group of stableGroups) {
    const fresh = group.filter((session) => newSessionIds.has(session.id));
    const retained = group.filter((session) => !newSessionIds.has(session.id));
    for (const session of fresh) {
      if (selected.length >= limit) break;
      if (selectedIds.has(session.id)) continue;
      selected.push(session);
      selectedIds.add(session.id);
    }
    const selectedFromGroup = group.filter((session) =>
      selectedIds.has(session.id)
    ).length;
    for (const session of retained.slice(0, Math.max(0, 2 - selectedFromGroup))) {
      if (selected.length >= limit) break;
      if (selectedIds.has(session.id)) continue;
      selected.push(session);
      selectedIds.add(session.id);
    }
    if (selected.length >= limit) break;
  }
  for (const session of candidates) {
    if (selected.length >= limit) break;
    if (!newSessionIds.has(session.id) || selectedIds.has(session.id)) continue;
    selected.push(session);
    selectedIds.add(session.id);
  }
  return selected;
}

function hasStableEvidence(sessions: CaptureSession[]): boolean {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const signature = evidenceSignature(session);
    if (!signature) continue;
    const count = (counts.get(signature) ?? 0) + 1;
    if (count >= 2) return true;
    counts.set(signature, count);
  }
  return false;
}

function evidenceSignature(session: CaptureSession): string {
  const domain = domainOf(session.sourceSnapshot.url ?? '');
  if (!domain || !session.resolution || !session.plan) return '';
  const action =
    session.resolution === 'auto' || session.resolution === 'allowed'
      ? 'prefer-folder'
      : session.resolution === 'rejected' || session.resolution === 'undone'
        ? 'avoid-folder'
        : '';
  return action
    ? `${domain}\u0000${action}\u0000${normalizePath(destinationPath(session))}`
    : '';
}

function latestAt(sessions: CaptureSession[]): number {
  return Math.max(
    ...sessions.map((session) => session.resolvedAt ?? session.updatedAt)
  );
}

function reviewsForSessions(
  sessions: CaptureSession[],
  memories: CaptureLearningMemory[]
): CaptureLearningSessionReview[] {
  return sessions.map((session) => {
    const domain = domainOf(session.sourceSnapshot.url ?? '');
    const path = normalizePath(destinationPath(session));
    const memoryIds = memories
      .filter(
        (memory) =>
          memory.domain === domain &&
          supportsAction(session, memory.action) &&
          normalizePath(memory.destinationPath) === path
      )
      .map((memory) => memory.id);
    return {
      sessionId: session.id,
      sourceUpdatedAt: session.updatedAt,
      outcome: memoryIds.length > 0 ? 'learned' : 'no-pattern',
      memoryIds
    };
  });
}

function supportsAction(
  session: CaptureSession,
  action: AiCaptureReviewMemory['action']
): boolean {
  return action === 'prefer-folder'
    ? session.resolution === 'auto' || session.resolution === 'allowed'
    : session.resolution === 'rejected' || session.resolution === 'undone';
}

function destinationPath(session: CaptureSession): string[] {
  if (!session.plan) return [];
  return logicalLearningPath([
    ...session.plan.destination.path.map((folder) => folder.title),
    ...session.plan.destination.newFolders
  ]);
}

function capConfidence(
  proposed: Confidence,
  evidence: CaptureSession[]
): Confidence {
  const hasExplicitDecision = evidence.some(
    (session) => session.resolution !== 'auto'
  );
  if (evidence.length < 3 || !hasExplicitDecision)
    return proposed === 'high' ? 'medium' : proposed;
  return proposed;
}

function normalizePath(path: string[]): string {
  return path.map((part) => part.trim().toLocaleLowerCase()).join('/');
}

function normalizeLearningPath(path: string[]): string {
  return normalizePath(logicalLearningPath(path));
}

function logicalLearningPath(path: string[]): string[] {
  const first = path[0]?.trim().toLocaleLowerCase();
  return first && BOOKMARK_ROOT_TITLES.has(first) ? path.slice(1) : path;
}

const BOOKMARK_ROOT_TITLES = new Set([
  '书签栏',
  '其他书签',
  '移动设备书签',
  'bookmarks bar',
  'other bookmarks',
  'mobile bookmarks'
]);

function memoryIdFor(
  domain: string,
  action: AiCaptureReviewMemory['action'],
  normalizedPath: string
): string {
  return `sleep-review:${domain}:${action}:${encodeURIComponent(normalizedPath)}`;
}

function domainOf(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase();
  } catch {
    return '';
  }
}

function safeText(value: string, limit: number): string {
  return Array.from(redactSensitiveText(value).trim()).slice(0, limit).join('');
}

function skippedResult(summary: string): CaptureSleepReviewResult {
  return {
    outcome: 'skipped',
    reviewedSessions: 0,
    learnedMemories: 0,
    summary
  };
}
