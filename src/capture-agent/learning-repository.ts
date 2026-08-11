import type { SiftmarkDatabase } from '../storage/database';
import type {
  CapturePreferenceRecord,
  CaptureSessionRecord
} from '../storage/schema';
import type {
  CaptureLearningMemory,
  CaptureSession
} from './types';

export interface CaptureLearningCommit {
  memories: CaptureLearningMemory[];
  sessionIds: string[];
  reviewedAt: number;
}

/** Persists a sleep review and its source markers as one atomic change. */
export interface CaptureLearningRepository {
  listUnreviewed(limit: number): Promise<CaptureSession[]>;
  getMemory(id: string): Promise<CaptureLearningMemory | null>;
  commit(input: CaptureLearningCommit): Promise<void>;
}

export class DexieCaptureLearningRepository
  implements CaptureLearningRepository
{
  constructor(private readonly database: SiftmarkDatabase) {}

  async listUnreviewed(limit: number): Promise<CaptureSession[]> {
    const records = await this.database.captureSessions
      .orderBy('updatedAt')
      .filter((record) => isReviewable(fromSessionRecord(record)))
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
    const sessionIds = [...new Set(input.sessionIds)];
    const memoryIds = input.memories.map((memory) => memory.id);
    await this.database.transaction(
      'rw',
      this.database.captureSessions,
      this.database.capturePreferences,
      async () => {
        const records = (
          await this.database.captureSessions.bulkGet(sessionIds)
        ).filter((record): record is CaptureSessionRecord => Boolean(record));
        const unreviewed = records.filter((record) =>
          isReviewable(fromSessionRecord(record))
        );
        if (unreviewed.length !== sessionIds.length)
          throw new Error('睡眠回顾来源已变化，请重新读取');
        if (input.memories.length > 0)
          await this.database.capturePreferences.bulkPut(
            input.memories.map(toPreferenceRecord)
          );
        if (unreviewed.length > 0)
          await this.database.captureSessions.bulkPut(
            unreviewed.map((record) => {
              const session = fromSessionRecord(record);
              return {
                ...record,
                payload: {
                  ...session,
                  learningReview: {
                    reviewedAt: input.reviewedAt,
                    outcome:
                      memoryIds.length > 0
                        ? ('learned' as const)
                        : ('no-pattern' as const),
                    memoryIds
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

function fromSessionRecord(record: CaptureSessionRecord): CaptureSession {
  const session = record.payload as unknown as CaptureSession;
  return {
    ...session,
    activities: Array.isArray(session.activities) ? session.activities : []
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
