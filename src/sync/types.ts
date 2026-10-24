import { z } from 'zod';

export const SYNC_CONFIG_KEY = 'siftmark.sync.webdav.v1';
export const SYNC_STATE_KEY = 'siftmark.sync.status.v1';
export const SYNC_FILE = 'siftmark-sync.v1.encrypted';
export const MAX_SYNC_BYTES = 64 * 1024 * 1024;

export interface SyncStorage {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

// 保留原配置键，旧版本留下的 autoSync 字段会被忽略，不再触发后台行为。
export interface WebDavConfig { endpoint: string; username: string; }
export interface SyncSecret { password: string; encryptionPassword: string; }
export type SyncValue = Record<string, unknown>;
export const syncTables = ['bookmarkMetadata', 'capturePreferences', 'captureSessions', 'organizationReviews',
  'visitAggregates', 'analysisProposals', 'aiUsageLog', 'notifications', 'softDeletedMetadata', 'specialFolderPlacements', 'operationLog'] as const;
export type SyncTable = typeof syncTables[number];
export interface SyncEntry { kind: 'bookmark' | 'tombstone' | 'setting' | 'record'; key: string; value: SyncValue; table?: SyncTable; }
export interface SyncDocument { format: 'siftmark-sync'; version: 1; entries: Record<string, SyncEntry>; }
export interface SyncState {
  id: 'webdav';
  deviceId: string;
  ids: Record<string, string>;
  rootIds: Record<string, string>;
  baseEntries: Record<string, SyncEntry>;
  recycled: Record<string, { parentId: string; at: number }>;
  lastSyncAt?: number;
  status: 'idle' | 'uploading' | 'downloading' | 'success' | 'failed';
  message: string;
  size?: number;
}

// WebDAV 只保存业务快照；连接口令、加密口令和设备授权永远留在当前浏览器。
const settings = new Set(['siftmark.ai.profiles.v1', 'siftmark.settings.appearance.v1', 'siftmark.settings.rules.v1',
  'siftmark.settings.prompt-rules.v1', 'siftmark.settings.special-folders.v1', 'siftmark.settings.recent-folder.v1',
  'siftmark.settings.profile-assignments.v1', 'siftmark.settings.folder-sorts.v1', 'siftmark.settings.smart-bookmark.v1']);
export function isSyncSetting(key: string): boolean { return settings.has(key); }

const entrySchema = z.object({
  kind: z.enum(['bookmark', 'tombstone', 'setting', 'record']), key: z.string().min(1).max(2000),
  value: z.record(z.unknown()), table: z.enum(syncTables).optional()
}).strict();
const documentSchema = z.object({ format: z.literal('siftmark-sync'), version: z.literal(1), entries: z.record(entrySchema) }).strict();

export function syncEntryId(entry: SyncEntry): string {
  if (entry.kind === 'record') return `record:${entry.table}:${entry.key}`;
  if (entry.kind === 'tombstone') return entry.value.targetKind === 'record' ? `record:${entry.value.table}:${entry.key}` : `${entry.value.targetKind ?? 'bookmark'}:${entry.key}`;
  return `${entry.kind}:${entry.key}`;
}

export function parseSyncDocument(input: unknown): SyncDocument {
  const document = documentSchema.parse(input) as SyncDocument;
  if (Object.keys(document.entries).length > 100_000) throw new Error('同步数据超过条目上限');
  const bookmarks = new Map<string, SyncEntry>();
  for (const [id, entry] of Object.entries(document.entries)) {
    if (id !== syncEntryId(entry) || ['__proto__', 'constructor', 'prototype'].includes(entry.key)) throw new Error('同步条目标识不一致');
    if (entry.kind === 'bookmark') {
      z.object({ parentId: z.string(), title: z.string().max(10000), index: z.number().int().nonnegative(), url: z.string().max(100000).optional() }).strict().parse(entry.value);
      if (!entry.key.startsWith('bookmark-')) throw new Error('同步书签标识无效');
      bookmarks.set(entry.key, entry);
    } else if (entry.kind === 'tombstone') {
      z.object({ deleted: z.literal(true), targetKind: z.enum(['bookmark', 'setting', 'record']), table: z.enum(syncTables).optional() }).strict().parse(entry.value);
      if (entry.value.targetKind === 'record' && !entry.value.table) throw new Error('同步记录删除标识无效');
      if (entry.value.targetKind === 'setting' && !isSyncSetting(entry.key)) throw new Error('同步设置不在允许范围');
      if (entry.value.targetKind === 'bookmark' && !entry.key.startsWith('bookmark-')) throw new Error('同步书签删除标识无效');
    } else if (entry.kind === 'record' && !entry.table) throw new Error('同步记录缺少数据表');
    else if (entry.kind === 'setting' && !isSyncSetting(entry.key)) throw new Error('同步设置不在允许范围');
  }
  for (const entry of bookmarks.values()) {
    let parent = String(entry.value.parentId); const seen = new Set([entry.key]);
    while (!/^root-[123]$/.test(parent)) {
      if (seen.has(parent)) throw new Error('同步目录存在循环引用');
      seen.add(parent); const folder = bookmarks.get(parent);
      if (!folder || folder.value.url) throw new Error('同步条目引用了已删除或不存在的目录，请保留父目录后重试');
      parent = String(folder.value.parentId);
    }
  }
  return document;
}

export function emptySyncDocument(): SyncDocument { return { format: 'siftmark-sync', version: 1, entries: {} }; }

// 仅供 IndexedDB 的旧状态记录使用；手动备份不会依赖它保存执行计划。
export interface SyncStateRecord { id: 'webdav'; value: unknown; }
