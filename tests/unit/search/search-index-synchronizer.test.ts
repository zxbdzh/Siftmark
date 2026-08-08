import { describe, expect, it, vi } from 'vitest';
import { LocalSearchIndex } from '../../../src/search/local-search-index';
import {
  SearchIndexSynchronizer,
  type SearchDocumentRepository
} from '../../../src/search/search-index-synchronizer';
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
    const putDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteDocuments = vi.fn().mockResolvedValue(undefined);
    const repository: SearchDocumentRepository = {
      listDocuments: vi
        .fn()
        .mockResolvedValue([
          document('a', '旧标题'),
          document('stale', '过期')
        ]),
      putDocuments,
      deleteDocuments
    };
    const index = new LocalSearchIndex();
    const synchronizer = new SearchIndexSynchronizer(index, repository);

    await synchronizer.sync([document('a', '新标题'), document('b', '新增')]);
    expect(putDocuments).toHaveBeenCalledOnce();
    expect(
      putDocuments.mock.calls[0]![0].map(
        (row: SearchDocument) => row.bookmarkId
      )
    ).toEqual(['a', 'b']);
    expect(deleteDocuments).toHaveBeenCalledWith(['stale']);
    expect(
      index.search({ text: '新标题', filters: {} }).map((row) => row.bookmarkId)
    ).toEqual(['a']);

    putDocuments.mockClear();
    deleteDocuments.mockClear();
    await synchronizer.sync([document('a', '新标题'), document('b', '新增')]);
    expect(putDocuments).not.toHaveBeenCalled();
    expect(deleteDocuments).not.toHaveBeenCalled();
  });
});
