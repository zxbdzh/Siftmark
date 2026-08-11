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

  it('recreates a removed bookmark from its recorded snapshot', async () => {
    const operation: OperationRecord = {
      id: 'remove',
      type: 'remove',
      bookmarkId: 'old-id',
      before: {
        parentId: 'inbox',
        index: 1,
        title: 'A',
        url: 'https://a.test'
      },
      after: {},
      idempotencyKey: 'key',
      createdAt: 1
    };
    const bookmarks = {
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'restored-id' })
    } as unknown as BookmarkRepository;
    const operations = {
      get: vi.fn().mockResolvedValue(operation),
      markUndone: vi.fn()
    } as unknown as OperationRepository;

    const result = await new UndoService(bookmarks, operations).undo('remove');

    expect(result.ok).toBe(true);
    expect(bookmarks.create).toHaveBeenCalledWith(operation.before);
  });

  it('undoes a batch in reverse operation order and reports conflicts', async () => {
    const first: OperationRecord = {
      id: 'first',
      type: 'create',
      bookmarkId: 'b1',
      batchId: 'batch-1',
      batchIndex: 0,
      before: {},
      after: {
        parentId: 'folder',
        index: 0,
        title: 'A',
        url: 'https://a.test'
      },
      idempotencyKey: 'key-1',
      createdAt: 1
    };
    const second: OperationRecord = {
      ...first,
      id: 'second',
      bookmarkId: 'b2',
      batchIndex: 1,
      after: {
        parentId: 'folder',
        index: 0,
        title: 'B',
        url: 'https://b.test'
      },
      idempotencyKey: 'key-2',
      createdAt: 2
    };
    const bookmarks = {
      get: vi.fn(async (id: string) =>
        id === 'b2'
          ? { id, ...second.after }
          : { id, ...first.after, title: 'changed' }
      ),
      remove: vi.fn().mockResolvedValue(undefined)
    } as unknown as BookmarkRepository;
    const operations = {
      listByBatch: vi.fn().mockResolvedValue([first, second]),
      get: vi.fn(async (id: string) => (id === 'first' ? first : second)),
      markUndone: vi.fn().mockResolvedValue(undefined)
    } as unknown as OperationRepository;

    const result = await new UndoService(bookmarks, operations).undoBatch(
      'batch-1'
    );

    expect(result).toEqual({ completed: 1, failed: 1 });
    expect(bookmarks.remove).toHaveBeenCalledTimes(1);
    expect(bookmarks.remove).toHaveBeenCalledWith('b2');
    expect(operations.markUndone).toHaveBeenCalledWith(
      'second',
      expect.any(Number)
    );
  });
});
