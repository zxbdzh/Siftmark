import { describe, expect, it, vi } from 'vitest';
import { HealthScanService } from '../../../src/health/health-scan-service';
import { LinkChecker } from '../../../src/health/link-checker';
import type { BookmarkMetadata } from '../../../src/storage/types';

describe('HealthScanService', () => {
  it('updates every matching bookmark and emits review proposals without deleting bookmarks', async () => {
    const rows = new Map<string, BookmarkMetadata>();
    const metadata = {
      get: vi.fn(async (bookmarkId: string) => rows.get(bookmarkId) ?? null),
      put: vi.fn(async (row: BookmarkMetadata) => { rows.set(row.bookmarkId, row); })
    };
    const proposals = { put: vi.fn() };
    const checker = new LinkChecker(vi.fn().mockResolvedValue(new Response(null, { status: 404 })), () => 10);
    const service = new HealthScanService(checker, metadata as never, proposals as never, () => 10, (() => { let id = 0; return () => `proposal-${id += 1}`; })());
    const result = await service.scan([
      { id: 'old', parentId: 'folder', index: 0, title: '旧', url: 'https://example.com', dateAdded: 1 },
      { id: 'new', parentId: 'folder', index: 1, title: '新', url: 'https://example.com?utm_source=test', dateAdded: 2 }
    ]);
    expect(result.duplicates.exact[0]).toMatchObject({ keepBookmarkId: 'old', bookmarkIds: ['old', 'new'] });
    expect(metadata.put).toHaveBeenCalledTimes(2);
    expect(proposals.put).toHaveBeenCalledTimes(3);
    expect(proposals.put).toHaveBeenCalledWith(expect.objectContaining({ category: 'duplicate', relatedBookmarkIds: ['old', 'new'] }));
  });
});
