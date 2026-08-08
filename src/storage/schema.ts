import type { BookmarkMetadata } from './types';

export interface ThumbnailRecord {
  bookmarkId: string;
  blob: Blob;
  hash: string;
  width: number;
  height: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface OperationLogRecord {
  id: string;
  type: 'move' | 'rename' | 'remove' | 'restore' | 'metadata';
  bookmarkId: string;
  batchId?: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: number;
  undoneAt?: number;
}

export interface TaskRecord {
  id: string;
  type: string;
  input: unknown;
  profileVersion?: string;
  state: string;
  completed: number;
  failed: number;
  retryCount: number;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface SearchIndexRecord {
  bookmarkId: string;
  keywordTokens: string[];
  embeddingProfile?: string;
  dimensions?: number;
  vectorVersion?: string;
}

export interface NotificationRecord {
  id: string;
  type: string;
  read: boolean;
  createdAt: number;
  taskId?: string;
}

export interface AiUsageLogRecord {
  requestId: string;
  profileId: string;
  model: string;
  taskType: string;
  tokens?: number;
  latency?: number;
  status: string;
  createdAt: number;
}

export interface SoftDeletedMetadata {
  bookmarkId: string;
  payload: BookmarkMetadata;
  deletedAt: number;
  originalLocation?: { parentId: string; index: number };
}

export interface VisitAggregate {
  bookmarkId: string;
  count: number;
  lastVisitedAt?: number;
  dailyBuckets: Record<string, number>;
}
