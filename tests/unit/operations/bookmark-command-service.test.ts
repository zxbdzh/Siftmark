import { describe, expect, it, vi } from 'vitest';
import { BookmarkCommandService } from '../../../src/operations/bookmark-command-service';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';
import type { OperationRepository } from '../../../src/operations/operation-repository';

describe('BookmarkCommandService', () => {
  it('records a move only after the native mutation succeeds', async () => {
    const bookmarks = { get: vi.fn().mockResolvedValue({ id: 'b1', parentId: 'old', index: 4, title: 'A' }), move: vi.fn().mockResolvedValue({ id: 'b1', parentId: 'new', index: 2, title: 'A' }) } as unknown as BookmarkRepository;
    const operations = { put: vi.fn() } as unknown as OperationRepository;
    const service = new BookmarkCommandService(bookmarks, operations, undefined, () => 1, vi.fn().mockReturnValueOnce('op').mockReturnValueOnce('key'));
    const result = await service.move({ bookmarkId: 'b1', parentId: 'new', index: 2 });
    expect(result.ok).toBe(true);
    expect(operations.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'op', before: { parentId: 'old', index: 4 } }));
  });

  it('rejects a stale expected snapshot', async () => {
    const bookmarks = { get: vi.fn().mockResolvedValue({ id: 'b1', parentId: 'changed', index: 4, title: 'A' }), move: vi.fn() } as unknown as BookmarkRepository;
    const service = new BookmarkCommandService(bookmarks, {} as OperationRepository);
    const result = await service.move({ bookmarkId: 'b1', parentId: 'new', expected: { parentId: 'old', index: 4 } });
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(bookmarks.move).not.toHaveBeenCalled();
  });
});
