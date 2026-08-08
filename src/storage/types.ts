import type { BookmarkId } from '../bookmarks/types';

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
export type HealthStatus =
  'unchecked' | 'healthy' | 'temporary' | 'dead' | 'restricted' | 'blocked';

export interface BookmarkMetadata {
  bookmarkId: BookmarkId;
  summary: string;
  tags: string[];
  note: string;
  confidence: Confidence;
  reason: string;
  health: HealthStatus;
  updatedAt: number;
}

export interface MetadataRepository {
  get(bookmarkId: BookmarkId): Promise<BookmarkMetadata | null>;
  list(): Promise<BookmarkMetadata[]>;
  put(metadata: BookmarkMetadata): Promise<void>;
  softDelete(bookmarkId: BookmarkId, deletedAt: number): Promise<void>;
  restore(bookmarkId: BookmarkId): Promise<void>;
  purgeDeletedBefore(timestamp: number): Promise<number>;
}
