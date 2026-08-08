import type { BookmarkId } from '../bookmarks/types';

export interface OperationRecord {
  id: string;
  type: 'create' | 'move' | 'rename' | 'remove' | 'restore' | 'metadata';
  bookmarkId: BookmarkId;
  batchId?: string;
  batchIndex?: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: number;
  undoneAt?: number;
}

export interface OperationConflict {
  code: 'conflict';
  bookmarkId: BookmarkId;
  expected: Record<string, unknown>;
  actual: object | null;
}

export interface OperationNotFound {
  code: 'not_found';
  id: string;
}

export type OperationError = OperationConflict | OperationNotFound | { code: 'unsupported'; type: string };
