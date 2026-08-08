import { describe, expect, it, vi } from 'vitest';
import type { BookmarkRepository } from '../../src/bookmarks/ports';
import { UndoService } from '../../src/operations/undo-service';
import type { OperationRepository } from '../../src/operations/operation-repository';
import type { OperationRecord } from '../../src/operations/types';

describe('operation undo', () => {
  it('restores the original parent and index', async () => {
    const operation: OperationRecord = { id: 'op', type: 'move', bookmarkId: 'b1', before: { parentId: 'old', index: 4 }, after: { parentId: 'new', index: 2 }, idempotencyKey: 'key', createdAt: 1 };
    const bookmarks = { get: vi.fn().mockResolvedValue({ id: 'b1', parentId: 'new', index: 2, title: 'A' }), move: vi.fn().mockResolvedValue({}) } as unknown as BookmarkRepository;
    const operations = { get: vi.fn().mockResolvedValue(operation), markUndone: vi.fn() } as unknown as OperationRepository;
    const result = await new UndoService(bookmarks, operations, undefined, () => 10).undo('op');
    expect(result.ok).toBe(true);
    expect(bookmarks.move).toHaveBeenLastCalledWith('b1', 'old', 4);
    expect(operations.markUndone).toHaveBeenCalledWith('op', 10);
  });

  it('restores a title when the bookmark still matches the recorded result', async () => {
    const operation: OperationRecord = { id: 'rename', type: 'rename', bookmarkId: 'b1', before: { title: 'Before' }, after: { title: 'After' }, idempotencyKey: 'key', createdAt: 1 };
    const bookmarks = { get: vi.fn().mockResolvedValue({ id: 'b1', parentId: '0', index: 0, title: 'After' }), update: vi.fn().mockResolvedValue({}) } as unknown as BookmarkRepository;
    const operations = { get: vi.fn().mockResolvedValue(operation), markUndone: vi.fn() } as unknown as OperationRepository;
    await new UndoService(bookmarks, operations).undo('rename');
    expect(bookmarks.update).toHaveBeenCalledWith('b1', { title: 'Before' });
  });

  it('does not overwrite a bookmark changed after the operation', async () => {
    const operation: OperationRecord = { id: 'op', type: 'move', bookmarkId: 'b1', before: { parentId: 'old', index: 4 }, after: { parentId: 'new', index: 2 }, idempotencyKey: 'key', createdAt: 1 };
    const bookmarks = { get: vi.fn().mockResolvedValue({ id: 'b1', parentId: 'third', index: 0, title: 'A' }), move: vi.fn() } as unknown as BookmarkRepository;
    const operations = { get: vi.fn().mockResolvedValue(operation) } as unknown as OperationRepository;
    const result = await new UndoService(bookmarks, operations).undo('op');
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(bookmarks.move).not.toHaveBeenCalled();
  });
});
