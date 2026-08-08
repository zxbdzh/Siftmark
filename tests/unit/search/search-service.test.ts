import { describe, expect, it } from 'vitest';
import { LocalSearchIndex } from '../../../src/search/local-search-index';
import { SearchService } from '../../../src/search/search-service';
import type { SearchDocument } from '../../../src/search/types';

const document = (bookmarkId: string, patch: Partial<SearchDocument>): SearchDocument => ({ bookmarkId, title: '', url: `https://${bookmarkId}.test`, folderId: 'f', folderPath: '资料', tags: [], summary: '', note: '', health: 'unchecked', confidence: 'unknown', createdAt: 1, updatedAt: 1, ...patch });

describe('SearchService', () => {
  it('ranks an exact title before a fuzzy summary match and applies filters', async () => {
    const index = new LocalSearchIndex();
    index.upsert(document('summary', { title: '其他', summary: '浏览器扩展开发指南', tags: ['开发'] }));
    index.upsert(document('exact', { title: '浏览器扩展', url: 'https://docs.example.com', tags: ['开发'] }));
    const service = new SearchService(index);
    expect((await service.search({ text: '浏览器扩展', filters: {} })).map((item) => item.bookmarkId)).toEqual(['exact', 'summary']);
    expect((await service.search({ text: '', filters: { domain: 'docs.example.com' } })).map((item) => item.bookmarkId)).toEqual(['exact']);
  });

  it('rebuilds in resumable chunks and updates individual IDs', async () => {
    const index = new LocalSearchIndex();
    const progress: number[] = [];
    await index.rebuild([document('a', { title: 'A' }), document('b', { title: 'B' })], 1, (completed) => progress.push(completed));
    index.upsert(document('a', { title: '更新' }));
    index.remove('b');
    expect(progress).toEqual([1, 2]);
    expect(index.search({ text: '更新', filters: {} }).map((item) => item.bookmarkId)).toEqual(['a']);
  });
});
