import type { SiftmarkDatabase } from '../storage/database';
import type { CaptureSessionRecord } from '../storage/schema';
import type {
  CaptureMessage,
  CaptureResolution,
  CaptureSession,
  CaptureSessionState
} from './types';
import { pendingCaptureStates } from './types';

export interface CaptureSessionRepository {
  get(id: string): Promise<CaptureSession | null>;
  list(limit?: number): Promise<CaptureSession[]>;
  listPending(limit?: number): Promise<CaptureSession[]>;
  put(session: CaptureSession): Promise<void>;
  appendMessage(id: string, message: CaptureMessage): Promise<CaptureSession>;
  resolve(
    id: string,
    resolution: CaptureResolution,
    resolvedAt: number,
    operationBatchId?: string
  ): Promise<CaptureSession | null>;
  expirePending(now: number): Promise<number>;
}

export class DexieCaptureSessionRepository
  implements CaptureSessionRepository
{
  constructor(private readonly database: SiftmarkDatabase) {}

  async get(id: string): Promise<CaptureSession | null> {
    const record = await this.database.captureSessions.get(id);
    return record ? fromRecord(record) : null;
  }

  async list(limit = 100): Promise<CaptureSession[]> {
    const rows = await this.database.captureSessions
      .orderBy('updatedAt')
      .reverse()
      .limit(limit)
      .toArray();
    return rows.map(fromRecord);
  }

  async listPending(limit = 100): Promise<CaptureSession[]> {
    const states = new Set<CaptureSessionState>(pendingCaptureStates);
    const rows = await this.database.captureSessions
      .orderBy('updatedAt')
      .reverse()
      .filter((record) => states.has(record.state as CaptureSessionState))
      .limit(limit)
      .toArray();
    return rows.map(fromRecord);
  }

  async put(session: CaptureSession): Promise<void> {
    await this.database.captureSessions.put(toRecord(session));
  }

  async appendMessage(
    id: string,
    message: CaptureMessage
  ): Promise<CaptureSession> {
    return this.database.transaction(
      'rw',
      this.database.captureSessions,
      async () => {
        const current = await this.get(id);
        if (!current) throw new Error(`Capture session not found: ${id}`);
        if (!pendingCaptureStates.includes(current.state))
          throw new Error(`Capture session is already resolved: ${id}`);
        const next: CaptureSession = {
          ...current,
          state: 'adjusting',
          messages: [...current.messages, message],
          updatedAt: Math.max(current.updatedAt, message.createdAt)
        };
        await this.put(next);
        return next;
      }
    );
  }

  async resolve(
    id: string,
    resolution: CaptureResolution,
    resolvedAt: number,
    operationBatchId?: string
  ): Promise<CaptureSession | null> {
    return this.database.transaction(
      'rw',
      this.database.captureSessions,
      async () => {
        const current = await this.get(id);
        if (!current) return null;
        const next: CaptureSession = {
          ...current,
          state: stateForResolution(resolution),
          messages: [],
          failure: undefined,
          resolution,
          resolvedAt,
          updatedAt: resolvedAt,
          ...(operationBatchId ? { operationBatchId } : {})
        };
        await this.put(next);
        return next;
      }
    );
  }

  async expirePending(now: number): Promise<number> {
    return this.database.transaction(
      'rw',
      this.database.captureSessions,
      async () => {
        const states = new Set<CaptureSessionState>(pendingCaptureStates);
        const rows = await this.database.captureSessions
          .where('expiresAt')
          .belowOrEqual(now)
          .filter((record) => states.has(record.state as CaptureSessionState))
          .toArray();
        if (rows.length === 0) return 0;
        await this.database.captureSessions.bulkPut(
          rows.map((record) =>
            toRecord({
              ...fromRecord(record),
              state: 'expired',
              messages: [],
              failure: undefined,
              resolution: 'expired',
              resolvedAt: now,
              updatedAt: now
            })
          )
        );
        return rows.length;
      }
    );
  }
}

function toRecord(session: CaptureSession): CaptureSessionRecord {
  return {
    id: session.id,
    bookmarkId: session.bookmarkId,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    payload: session as unknown as Record<string, unknown>
  };
}

function fromRecord(record: CaptureSessionRecord): CaptureSession {
  return record.payload as unknown as CaptureSession;
}

function stateForResolution(
  resolution: CaptureResolution
): CaptureSessionState {
  if (resolution === 'rejected') return 'rejected';
  if (resolution === 'expired') return 'expired';
  if (resolution === 'undone') return 'undone';
  return 'applied';
}
