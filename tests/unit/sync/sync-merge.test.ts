import { describe, expect, it } from 'vitest';
import { parseSyncDocument, syncEntryId, type SyncEntry } from '../../../src/sync/types';

const folder: SyncEntry = {kind: 'bookmark', key: 'bookmark-folder', value: {parentId: 'root-1', index: 0, title: 'Folder'}};
const bookmark: SyncEntry = {kind: 'bookmark', key: 'bookmark-item', value: {parentId: 'bookmark-folder', index: 0, title: 'Item', url: 'https://example.test/'}};

function document(entries: SyncEntry[]) {
  return {format: 'siftmark-sync', version: 1 as const, entries: Object.fromEntries(entries.map(entry => [syncEntryId(entry), entry]))};
}

describe('手动备份快照结构', () => {
  it('接受完整书签快照并保持稳定条目标识', () => {
    const parsed = parseSyncDocument(document([folder, bookmark]));
    expect(Object.keys(parsed.entries)).toEqual(['bookmark:bookmark-folder', 'bookmark:bookmark-item']);
  });

  it('拒绝孤儿目录、循环目录和快照外字段', () => {
    const orphan = {...bookmark, value: {...bookmark.value, parentId: 'bookmark-missing'}};
    expect(() => parseSyncDocument(document([orphan]))).toThrow('不存在的目录');
    const first: SyncEntry = {kind: 'bookmark', key: 'bookmark-a', value: {parentId: 'bookmark-b', index: 0, title: 'A'}};
    const second: SyncEntry = {kind: 'bookmark', key: 'bookmark-b', value: {parentId: 'bookmark-a', index: 0, title: 'B'}};
    expect(() => parseSyncDocument(document([first, second]))).toThrow('循环引用');
    expect(() => parseSyncDocument({format: 'siftmark-sync', version: 1, entries: {}, extra: true})).toThrow();
  });
});
