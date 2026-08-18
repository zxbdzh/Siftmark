import type { SiftmarkDatabase } from '../storage/database';
import type {
  CapturePreferenceRecord,
  CaptureSessionRecord
} from '../storage/schema';
import type { CaptureLearningMemory, CaptureSession } from './types';

export interface CaptureLearningCommit {
  memories: CaptureLearningMemory[];
  reviews: CaptureLearningSessionReview[];
  reviewedAt: number;
}

export interface CaptureLearningSessionReview {
  sessionId: string;
  sourceUpdatedAt: number;
  outcome: 'learned' | 'no-pattern';
  memoryIds: string[];
}

/** Persists a sleep review and its source markers as one atomic change. */
export interface CaptureLearningRepository {
  listUnreviewed(limit: number): Promise<CaptureSession[]>;
  listReviewCandidates(limit: number): Promise<CaptureSession[]>;
  getMemory(id: string): Promise<CaptureLearningMemory | null>;
  commit(input: CaptureLearningCommit): Promise<void>;
}

export class DexieCaptureLearningRepository implements CaptureLearningRepository {
  constructor(private readonly database: SiftmarkDatabase) {}

  async listUnreviewed(limit: number): Promise<CaptureSession[]> {
    const records = await this.database.captureSessions
      .orderBy('updatedAt')
      .filter((record) => isReviewable(fromSessionRecord(record)))
      .limit(limit)
      .toArray();
    return records.map(fromSessionRecord);
  }

  async listReviewCandidates(limit: number): Promise<CaptureSession[]> {
    const records = await this.database.captureSessions
      .orderBy('updatedAt')
      .reverse()
      .filter((record) => isReviewCandidate(fromSessionRecord(record)))
      .limit(limit)
      .toArray();
    return records.map(fromSessionRecord);
  }

  async getMemory(id: string): Promise<CaptureLearningMemory | null> {
    const record = await this.database.capturePreferences.get(id);
    if (!record) return null;
    const preference = record.payload as unknown as CaptureLearningMemory;
    return preference.kind === 'learned' ? preference : null;
  }

  async commit(input: CaptureLearningCommit): Promise<void> {
    const reviews = dedupeReviews(input.reviews);
    const sessionIds = reviews.map((review) => review.sessionId);
    await this.database.transaction(
      'rw',
      this.database.captureSessions,
      this.database.capturePreferences,
      async () => {
        const records = (
          await this.database.captureSessions.bulkGet(sessionIds)
        ).filter((record): record is CaptureSessionRecord => Boolean(record));
        const reviewsBySessionId = new Map(
          reviews.map((review) => [review.sessionId, review])
        );
        const reviewable = records.filter((record) => {
          const session = fromSessionRecord(record);
          const review = reviewsBySessionId.get(session.id);
          return (
            review &&
            session.updatedAt === review.sourceUpdatedAt &&
            isReviewCandidate(session)
          );
        });
        if (reviewable.length !== sessionIds.length)
          throw new Error('睡眠回顾来源已变化，请重新读取');
        if (input.memories.length > 0)
          await this.database.capturePreferences.bulkPut(
            input.memories.map(toPreferenceRecord)
          );
        if (reviewable.length > 0)
          await this.database.captureSessions.bulkPut(
            reviewable.map((record) => {
              const session = fromSessionRecord(record);
              const review = reviews.find(
                (candidate) => candidate.sessionId === session.id
              )!;
              return {
                ...record,
                payload: {
                  ...session,
                  learningReview: {
                    reviewedAt: input.reviewedAt,
                    outcome: review.outcome,
                    memoryIds: review.memoryIds
                  }
                } as unknown as Record<string, unknown>
              };
            })
          );
      }
    );
  }
}

function isReviewable(session: CaptureSession): boolean {
  return Boolean(
    session.plan &&
    session.resolvedAt &&
    !session.learningReview &&
    session.resolution &&
    ['auto', 'allowed', 'rejected', 'undone'].includes(session.resolution)
  );
}

function isReviewCandidate(session: CaptureSession): boolean {
  return Boolean(
    session.plan &&
    session.resolvedAt &&
    session.resolution &&
    ['auto', 'allowed', 'rejected', 'undone'].includes(session.resolution) &&
    (!session.learningReview || session.learningReview.outcome === 'no-pattern')
  );
}

function dedupeReviews(
  reviews: CaptureLearningSessionReview[]
): CaptureLearningSessionReview[] {
  const unique = new Map<string, CaptureLearningSessionReview>();
  for (const review of reviews) {
    if (unique.has(review.sessionId))
      throw new Error('睡眠回顾来源重复，请重新读取');
    unique.set(review.sessionId, {
      ...review,
      memoryIds: [...new Set(review.memoryIds)]
    });
  }
  return [...unique.values()];
}

function fromSessionRecord(record: CaptureSessionRecord): CaptureSession {
  const session = record.payload as unknown as CaptureSession;
  return {
    ...session,
    activities: Array.isArray(session.activities) ? session.activities : [],
    messages: Array.isArray(session.messages) ? session.messages : []
  };
}

function toPreferenceRecord(
  memory: CaptureLearningMemory
): CapturePreferenceRecord {
  return {
    id: memory.id,
    kind: memory.kind,
    domain: memory.domain,
    updatedAt: memory.updatedAt,
    payload: memory as unknown as Record<string, unknown>
  };
}
