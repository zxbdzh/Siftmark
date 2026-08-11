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

  it('records a removed bookmark so the action remains undoable', async () => {
    const bookmark = {
      id: 'b1',
      parentId: 'inbox',
      index: 2,
      title: 'Duplicate',
      url: 'https://example.test'
    };
    const bookmarks = {
      get: vi.fn().mockResolvedValue(bookmark),
      remove: vi.fn().mockResolvedValue(undefined)
    } as unknown as BookmarkRepository;
    const operations = { put: vi.fn() } as unknown as OperationRepository;
    const service = new BookmarkCommandService(
      bookmarks,
      operations,
      undefined,
      () => 1,
      vi.fn().mockReturnValueOnce('op').mockReturnValueOnce('key')
    );

    const result = await service.remove({
      bookmarkId: 'b1',
      batchId: 'batch',
      expected: bookmark
    });

    expect(result).toMatchObject({ ok: true, value: { type: 'remove' } });
    expect(bookmarks.remove).toHaveBeenCalledWith('b1');
    expect(operations.put).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'remove',
        before: {
          parentId: 'inbox',
          index: 2,
          title: 'Duplicate',
          url: 'https://example.test'
        },
        after: {}
      })
    );
  });
});
