import type { BookmarkMetadata } from '../storage/types';
import type { OperationLogRecord } from '../storage/schema';

export interface BackupManifestV1 {
  format: 'siftmark-backup';
  version: 1;
  exportedAt: string;
  appVersion: string;
  counts: {
    folders: number;
    bookmarks: number;
    metadata: number;
    thumbnails: number;
  };
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

export interface ImportNode {
  sourceId: string;
  kind: 'folder' | 'bookmark';
  parentSourceId: string | null;
  title: string;
  url?: string;
  index: number;
  metadata?: Partial<BookmarkMetadata>;
}

export interface ImportGraph {
  format: 'siftmark' | 'netscape-html' | 'markai';
  version: number;
  nodes: ImportNode[];
  operations: OperationLogRecord[];
  settings: Record<string, unknown>;
  history: Array<Record<string, unknown>>;
  blockedDomains: string[];
  unknownFields: string[];
  integrity: 'verified' | 'unverified';
  keyPresence: 'none' | 'redacted' | 'encrypted';
  thumbnailBytes: number;
}

export interface NativeBackupDataV1 {
  version: 1;
  nodes: ImportNode[];
  operations: OperationLogRecord[];
  settings: Record<string, unknown>;
  history: Array<Record<string, unknown>>;
  blockedDomains: string[];
}
