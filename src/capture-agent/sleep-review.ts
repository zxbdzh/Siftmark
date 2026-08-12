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
  CaptureLearningRepository
} from './learning-repository';
import type {
  CaptureLearningMemory,
  CaptureSession
} from './types';

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
    | 'getSleepReviewSettings'
    | 'getSleepReviewStatus'
    | 'setSleepReviewStatus'
  >;
  hasActiveCapture(): Promise<boolean>;
  now?: () => number;
}

export type CaptureSleepReviewOutcome =
  | 'waiting'
  | 'learned'
  | 'reviewed'
  | 'skipped'
  | 'failed';

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
    if (!configuration.enabled)
      return skippedResult('睡眠回顾尚未启用');
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

    const sessions = await this.dependencies.learning.listUnreviewed(
      configuration.batchSize
    );
    if (sessions.length < MIN_REVIEW_SESSIONS) {
      const summary = `已积累 ${sessions.length} / ${MIN_REVIEW_SESSIONS} 个新结果`;
      await this.dependencies.settings.setSleepReviewStatus(
        statusWithAttempt(previous, attempt, 'waiting', summary, {
          pendingSessions: sessions.length
        })
      );
      return {
        outcome: 'waiting',
        reviewedSessions: 0,
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
        sessionIds: sessions.map((session) => session.id),
        reviewedAt: now
      };
      await this.dependencies.learning.commit(commit);
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
          pendingSessions: 0,
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
      const pathKey = normalizePath(proposal.destinationPath);
      const matching = supporting.filter(
        (session) => normalizePath(destinationPath(session)) === pathKey
      );
      if (matching.length < 2) continue;
      seenDomains.add(domain);
      const id = `sleep-review:${domain}`;
      const existing = await this.dependencies.learning.getMemory(id);
      const sameMemory = Boolean(
        existing &&
          existing.action === proposal.action &&
          normalizePath(existing.destinationPath) === pathKey
      );
      const latest = [...evidence].sort(
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
        destinationPath: proposal.destinationPath.map((part) => part.trim()),
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
    resolution: session.resolution as 'auto' | 'allowed' | 'rejected' | 'undone',
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

function supportsAction(
  session: CaptureSession,
  action: AiCaptureReviewMemory['action']
): boolean {
  return action === 'prefer-folder'
    ? session.resolution === 'auto' || session.resolution === 'allowed'
    : session.resolution === 'rejected' || session.resolution === 'undone';
}

function destinationPath(session: CaptureSession): string[] {
  return session.plan
    ? [
        ...session.plan.destination.path.map((folder) => folder.title),
        ...session.plan.destination.newFolders
      ]
    : [];
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
