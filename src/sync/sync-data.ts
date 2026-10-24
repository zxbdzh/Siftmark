import type { BookmarkNode } from '../bookmarks/types';
import type { SiftmarkDatabase } from '../storage/database';
import { sha256Hex } from '../backup/checksum';
import { stableStringify } from '../backup/native-exporter';
import { parseModelProfile } from '../ai/profiles/model-profile';
import { isSyncSetting, syncEntryId, syncTables, type SyncDocument, type SyncEntry, type SyncState, type SyncStorage, type SyncValue } from './types';

const referenceFields = new Set(['bookmarkId', 'parentId', 'folderId', 'targetFolderId', 'destinationFolderId', 'originalParentId', 'inboxId', 'archiveId', 'recycleBinId', 'bookmarkIds', 'sourceBookmarkIds', 'relatedBookmarkIds', 'folderIds', 'keepBookmarkId', 'excludedFolderIds']);
// 仅转换书签引用字段，防止标题、API Key 或查询词碰巧等于原生 ID 时被改写。
export function mapReferences(value: unknown, map: (id: string) => string, field = ''): unknown {
  if (typeof value === 'string') return referenceFields.has(field) ? map(value) : value;
  if (Array.isArray(value)) return value.map(item => mapReferences(item, map, field));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapReferences(child, map, key)]));
  return value;
}
export function tombstone(entry: SyncEntry): SyncEntry {
  return entry.kind === 'tombstone' ? entry : {kind: 'tombstone', key: entry.key, value: {deleted: true, targetKind: entry.kind, ...(entry.table ? {table: entry.table} : {})}};
}
export function documentOf(entries: Record<string, SyncEntry>): SyncDocument { return {format: 'siftmark-sync', version: 1, entries}; }
export function same(a: unknown, b: unknown): boolean { return stableStringify(a ?? null) === stableStringify(b ?? null); }
export function rowKey(database: SiftmarkDatabase, table: string): string { return String(database.table(table).schema.primKey.keyPath); }

export async function captureSyncData(nodes: BookmarkNode[], state: SyncState, database: SiftmarkDatabase, local: SyncStorage) {
  const ids = {...state.ids}; const rootIds: Record<string, string> = {};
  const roots = nodes.filter(node => node.parentId === '0' && node.id !== '0').sort((a,b) => a.index - b.index);
  roots.forEach((root, index) => {rootIds['root-' + (index + 1)] = root.id;});
  if (roots.length > 3 || !roots.length) throw new Error('浏览器书签根目录无法映射，已停止同步');
  const refs = new Map(Object.entries(rootIds).map(([token, id]) => [id, token]));
  for (const [token, id] of Object.entries(ids)) refs.set(id, token);
  const occurrences = new Map<string, number>();
  for (const node of nodes) {
    if (node.id === '0' || node.parentId === '0') continue;
    const parent = refs.get(node.parentId);
    if (!parent) throw new Error('书签树包含未识别父目录，未开始同步');
    const signature = JSON.stringify([parent, node.title, node.url ?? '']);
    const occurrence = occurrences.get(signature) ?? 0; occurrences.set(signature, occurrence + 1);
    if (refs.has(node.id)) continue;
    let token = 'bookmark-' + await sha256Hex(new TextEncoder().encode(JSON.stringify([signature, occurrence])));
    // 删除后重新收藏是新对象，不复用已经发出的删除标记。
    if (ids[token] && ids[token] !== node.id) token = 'bookmark-' + crypto.randomUUID();
    ids[token] = node.id; refs.set(node.id, token);
  }
  const entries: Record<string, SyncEntry> = {};
  const byId = new Map(nodes.map(node => [node.id, node]));
  const recycledNative = new Set(Object.entries(state.recycled).filter(([token, placement]) => byId.get(ids[token]!)?.parentId === placement.parentId).map(([token]) => ids[token]).filter(Boolean));
  const hidden = (node: BookmarkNode): boolean => {
    const seen = new Set<string>(); let current: BookmarkNode | undefined = node;
    while (current && !seen.has(current.id)) { if (recycledNative.has(current.id)) return true; seen.add(current.id); current = byId.get(current.parentId); }
    return false;
  };
  for (const node of nodes) {
    if (node.id === '0' || node.parentId === '0' || hidden(node)) continue;
    const entry: SyncEntry = {kind: 'bookmark', key: refs.get(node.id)!, value: {title: node.title, parentId: refs.get(node.parentId), index: node.index, ...(node.url ? {url: node.url} : {})}};
    entries[syncEntryId(entry)] = entry;
  }
  const encode = (value: unknown) => mapReferences(value, id => refs.has(id) ? '@bookmark:' + refs.get(id) : id) as SyncValue;
  for (const [key, value] of Object.entries(await local.get(null))) if (isSyncSetting(key)) {
    let encoded: unknown = encode(value);
    // 导出前统一模型档案的默认字段，避免设备 B 导入后产生无意义的配置回流。
    if (key === 'siftmark.ai.profiles.v1' && Array.isArray(encoded)) encoded = encoded.map(profile => parseModelProfile(profile));
    // 原生收藏接管属于每台设备的授权，不参与跨设备比较，避免授权值来回覆盖。
    if (key.endsWith('smart-bookmark.v1') && encoded && typeof encoded === 'object') {
      encoded = {...encoded}; delete (encoded as Record<string, unknown>).captureNativeBookmarks;
    }
    if (key.endsWith('folder-sorts.v1') && encoded && typeof encoded === 'object') encoded = Object.fromEntries(Object.entries(encoded).map(([id,v]) => [refs.has(id) ? '@bookmark:' + refs.get(id) : id, v]));
    const entry: SyncEntry = {kind: 'setting', key, value: {value: encoded}}; entries[syncEntryId(entry)] = entry;
  }
  for (const table of syncTables) for (const row of await database.table(table).toArray() as SyncValue[]) {
    if (table === 'operationLog' && String(row.idempotencyKey).startsWith('webdav:')) continue; // 同步自身的执行检查点留在本机，避免每轮制造新日志。
    const primary = rowKey(database, table); const rawKey = String(row[primary]);
    const key = primary === 'bookmarkId' ? refs.get(rawKey) ?? 'missing-' + state.deviceId + '-' + rawKey : rawKey;
    const value = encode(row);
    if (table === 'operationLog') delete value.syncImported;
    // 正在执行的方案只作为历史同步，另一设备不会接管任务或重放操作。
    if (table === 'captureSessions') {
      value.state = 'ended';
      if (value.payload && typeof value.payload === 'object') value.payload = {...value.payload, state: 'ended'};
    }
    const entry: SyncEntry = {kind: 'record', table, key, value}; entries[syncEntryId(entry)] = entry;
  }
  for (const [id, previous] of Object.entries(state.baseEntries)) if (!entries[id]) entries[id] = tombstone(previous);
  return {document: documentOf(entries), ids, rootIds};
}
export function decodeSyncValue(value: unknown, state: SyncState): unknown {
  const resolve = (id: string) => id.startsWith('@bookmark:') ? state.rootIds[id.slice(10)] ?? state.ids[id.slice(10)] ?? 'missing-' + id.slice(10) : id;
  return mapReferences(value, resolve);
}
