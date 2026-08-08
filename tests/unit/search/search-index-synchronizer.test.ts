import { describe, expect, it, vi } from 'vitest';
import { LocalSearchIndex } from '../../../src/search/local-search-index';
import { SearchIndexSynchronizer, type SearchDocumentRepository } from '../../../src/search/search-index-synchronizer';
import type { SearchDocument } from '../../../src/search/types';

const document = (bookmarkId: string, title: string): SearchDocument => ({
  bookmarkId,
  title,
  url: `https://${bookmarkId}.test`,
  folderId: 'folder',
  folderPath: '资料',
  tags: [],
  summary: '',
  note: '',
  health: 'unchecked',
  confidence: 'unknown',
  createdAt: 1,
  updatedAt: 1
});

describe('SearchIndexSynchronizer', () => {
  it('persists only changed IDs and removes stale rows', async () => {
    const putDocument = vi.fn().mockResolvedValue(undefined);
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    const repository: SearchDocumentRepository = {
      listDocuments: vi.fn().mockResolvedValue([document('a', '旧标题'), document('stale', '过期')]),
      putDocument,
      deleteDocument
    };
    const index = new LocalSearchIndex();
    const synchronizer = new SearchIndexSynchronizer(index, repository);

    await synchronizer.sync([document('a', '新标题'), document('b', '新增')]);
    expect(putDocument.mock.calls.map(([row]) => row.bookmarkId)).toEqual(['a', 'b']);
    expect(deleteDocument).toHaveBeenCalledWith('stale');
    expect(index.search({ text: '新标题', filters: {} }).map((row) => row.bookmarkId)).toEqual(['a']);

    putDocument.mockClear();
    deleteDocument.mockClear();
    await synchronizer.sync([document('a', '新标题'), document('b', '新增')]);
    expect(putDocument).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});
