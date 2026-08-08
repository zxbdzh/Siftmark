import type { SiftmarkDatabase } from '../storage/database';
import type { OperationRecord } from './types';

export interface OperationRepository {
  get(id: string): Promise<OperationRecord | null>;
  listRecent(limit?: number): Promise<OperationRecord[]>;
  put(operation: OperationRecord): Promise<void>;
  markUndone(id: string, undoneAt: number): Promise<void>;
}

export class DexieOperationRepository implements OperationRepository {
  constructor(private readonly db: SiftmarkDatabase) {}

  get(id: string): Promise<OperationRecord | null> {
    return this.db.operationLog.get(id).then((value) => value ?? null);
  }

  listRecent(limit = 20): Promise<OperationRecord[]> {
    return this.db.operationLog.orderBy('createdAt').reverse().limit(limit).toArray();
  }

  async put(operation: OperationRecord): Promise<void> {
    await this.db.operationLog.put(operation);
  }

  async markUndone(id: string, undoneAt: number): Promise<void> {
    await this.db.operationLog.update(id, { undoneAt });
  }
}
