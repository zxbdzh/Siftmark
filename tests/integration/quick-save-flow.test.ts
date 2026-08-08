import { describe, expect, it, vi } from 'vitest';
import { SaveService } from '../../src/bookmarks/save-service';

describe('quick save flow', () => {
  it('returns after native creation without waiting for AI', async () => {
    const bookmarks = {
      getTree: vi
        .fn()
        .mockResolvedValue([
          { id: 'f', parentId: '0', index: 0, title: '书签' }
        ]),
      create: vi.fn().mockResolvedValue({ id: 'b1' })
    };
    const queue = {
      enqueue: vi.fn().mockImplementation(() => new Promise(() => undefined))
    };
    await expect(
      new SaveService(bookmarks as never, queue).saveCurrentTab({
        id: 1,
        title: 'A',
        url: 'https://a.test'
      })
    ).resolves.toMatchObject({ bookmarkId: 'b1', analysisQueued: true });
  });

  it('journals one shared batch id for every saved tab', async () => {
    const bookmarks = {
      getTree: vi
        .fn()
        .mockResolvedValue([
          { id: 'f', parentId: '0', index: 0, title: '书签' }
        ]),
      create: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'b1',
          parentId: 'f',
          index: 0,
          title: 'A',
          url: 'https://a.test'
        })
        .mockResolvedValueOnce({
          id: 'b2',
          parentId: 'f',
          index: 0,
          title: 'B',
          url: 'https://b.test'
        })
    };
    const operations = { put: vi.fn() };
    const createId = vi
      .fn()
      .mockReturnValueOnce('batch-1')
      .mockReturnValueOnce('operation-1')
      .mockReturnValueOnce('task-1')
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('operation-2')
      .mockReturnValueOnce('task-2')
      .mockReturnValueOnce('key-2');
    const service = new SaveService(
      bookmarks as never,
      { enqueue: vi.fn().mockResolvedValue(undefined) },
      operations as never,
      createId
    );

    const results = await service.saveTabs(
      [
        { id: 1, title: 'A', url: 'https://a.test' },
        { id: 2, title: 'B', url: 'https://b.test' }
      ],
      { parentId: 'f' }
    );

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.batchId)).toEqual([
      'batch-1',
      'batch-1'
    ]);
    expect(operations.put).toHaveBeenCalledTimes(2);
    expect(operations.put).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ batchId: 'batch-1', batchIndex: 0 })
    );
    expect(operations.put).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ batchId: 'batch-1', batchIndex: 1 })
    );
  });

  it('creates every native bookmark before queuing batch analysis', async () => {
    let created = 0;
    const queuedAfterCreate: number[] = [];
    const bookmarks = {
      getTree: vi
        .fn()
        .mockResolvedValue([
          { id: 'f', parentId: '0', index: 0, title: '书签' }
        ]),
      create: vi.fn(async (input: Record<string, unknown>) => ({
        ...input,
        id: `b${++created}`
      }))
    };
    const queue = {
      enqueue: vi.fn(async () => {
        queuedAfterCreate.push(created);
      })
    };

    const results = await new SaveService(bookmarks as never, queue).saveTabs([
      { id: 1, title: 'A', url: 'https://a.test' },
      { id: 2, title: 'B', url: 'https://b.test' }
    ]);

    expect(queuedAfterCreate).toEqual([2, 2]);
    expect(results.every((result) => result.analysisQueued)).toBe(true);
    expect(results.every((result) => result.taskId)).toBe(true);
  });
});
