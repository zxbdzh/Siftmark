import { describe, expect, it, vi } from 'vitest';
import { ok } from '../../../src/utils/result';
import {
  LocalCaptureExecutor,
  type CaptureSession
} from '../../../src/capture-agent';
import type { OperationRecord } from '../../../src/operations/types';

describe('LocalCaptureExecutor', () => {
  it('moves a risky capture to the configured inbox before approval', async () => {
    const dependencies = createDependencies();
    const executor = new LocalCaptureExecutor(dependencies);

    const result = await executor.stageForApproval(session());

    expect(result.batchId).toBe('batch-1');
    expect(dependencies.commands.move).toHaveBeenCalledWith({
      bookmarkId: 'bookmark',
      parentId: 'inbox',
      batchId: 'batch-1',
      batchIndex: 0,
      expected: { parentId: 'source', index: 0 }
    });
  });

  it('executes the displayed move, rename and metadata as one batch', async () => {
    const dependencies = createDependencies();
    dependencies.bookmarks.get.mockResolvedValueOnce({
      id: 'bookmark',
      parentId: 'inbox',
      index: 0,
      title: 'Original',
      url: 'https://example.test'
    });
    const executor = new LocalCaptureExecutor(dependencies);

    const result = await executor.execute(
      session({
        sourceSnapshot: {
          id: 'bookmark',
          parentId: 'inbox',
          index: 0,
          title: 'Original',
          url: 'https://example.test'
        }
      })
    );

    expect(result).toEqual({ batchId: 'batch-1', bookmarkId: 'bookmark' });
    expect(dependencies.commands.move).toHaveBeenCalledWith(
      expect.objectContaining({
        bookmarkId: 'bookmark',
        parentId: 'destination',
        batchId: 'batch-1'
      })
    );
    expect(dependencies.commands.rename).toHaveBeenCalledWith(
      expect.objectContaining({ bookmarkId: 'bookmark', title: 'Better title' })
    );
    expect(dependencies.commands.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        bookmarkId: 'bookmark',
        summary: 'Summary',
        tags: ['AI']
      }),
      'batch-1',
      2
    );
  });

  it('creates only the proposed leaf below an existing parent', async () => {
    const dependencies = createDependencies();
    dependencies.bookmarks.get
      .mockResolvedValueOnce({
        id: 'bookmark',
        parentId: 'inbox',
        index: 0,
        title: 'Original',
        url: 'https://example.test'
      })
      .mockResolvedValueOnce({
        id: 'destination',
        parentId: 'root',
        index: 0,
        title: '开发'
      });
    dependencies.commands.create.mockResolvedValueOnce(
      operation('create', 'new-leaf')
    );
    const executor = new LocalCaptureExecutor(dependencies);

    await executor.execute(
      session({
        sourceSnapshot: {
          id: 'bookmark',
          parentId: 'inbox',
          index: 0,
          title: 'Original',
          url: 'https://example.test'
        },
        plan: plan({
          destination: {
            folderId: 'destination',
            path: [{ id: 'destination', title: '开发' }],
            newFolders: ['Agent'],
            creationSource: 'automatic'
          }
        })
      })
    );

    expect(dependencies.commands.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'destination',
        title: 'Agent',
        idempotencyKey: expect.stringContaining('folder:0')
      })
    );
    expect(dependencies.commands.move).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'new-leaf' })
    );
  });

  it('creates multiple proposed levels only within the plan limit', async () => {
    const dependencies = createDependencies();
    const executor = new LocalCaptureExecutor(dependencies);

    await executor.execute(
      session({
        plan: plan({
          destination: {
            folderId: 'destination',
            path: [{ id: 'destination', title: '开发' }],
            newFolders: ['AI', 'Agent'],
            creationSource: 'automatic',
            maxNewFolderLevels: 2
          }
        })
      })
    );

    expect(dependencies.commands.create).toHaveBeenCalledTimes(2);

    dependencies.commands.create.mockClear();
    await expect(
      executor.execute(
        session({
          plan: plan({
            destination: {
              folderId: 'destination',
              path: [{ id: 'destination', title: '开发' }],
              newFolders: ['AI', 'Agent'],
              creationSource: 'automatic',
              maxNewFolderLevels: 1
            }
          })
        })
      )
    ).rejects.toThrow('目录创建层级');
    expect(dependencies.commands.create).not.toHaveBeenCalled();
  });

  it('merges an exact duplicate into the existing bookmark and removes the provisional copy', async () => {
    const dependencies = createDependencies();
    dependencies.bookmarks.get
      .mockResolvedValueOnce({
        id: 'bookmark',
        parentId: 'inbox',
        index: 0,
        title: 'Original',
        url: 'https://example.test'
      })
      .mockResolvedValueOnce({
        id: 'destination',
        parentId: 'root',
        index: 0,
        title: 'AI'
      })
      .mockResolvedValueOnce({
        id: 'existing',
        parentId: 'old-folder',
        index: 1,
        title: 'Existing',
        url: 'https://example.test'
      });
    dependencies.metadata.get.mockResolvedValue({
      bookmarkId: 'existing',
      summary: 'Old summary',
      tags: ['old'],
      note: 'Keep this note',
      confidence: 'medium',
      reason: 'old',
      health: 'healthy',
      updatedAt: 1
    });
    const executor = new LocalCaptureExecutor(dependencies);

    const result = await executor.execute(
      session({
        sourceSnapshot: {
          id: 'bookmark',
          parentId: 'inbox',
          index: 0,
          title: 'Original',
          url: 'https://example.test'
        },
        plan: plan({
          relatedBookmarks: [
            {
              id: 'existing',
              title: 'Existing',
              url: 'https://example.test',
              relation: 'exact'
            }
          ]
        })
      })
    );

    expect(result.bookmarkId).toBe('existing');
    expect(dependencies.commands.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        bookmarkId: 'existing',
        note: 'Keep this note',
        tags: ['old', 'AI']
      }),
      'batch-1',
      expect.any(Number)
    );
    expect(dependencies.commands.remove).toHaveBeenCalledWith(
      expect.objectContaining({ bookmarkId: 'bookmark', batchId: 'batch-1' })
    );
  });

  it('stops before any writes when the source snapshot is stale', async () => {
    const dependencies = createDependencies();
    dependencies.bookmarks.get.mockResolvedValueOnce({
      id: 'bookmark',
      parentId: 'changed',
      index: 3,
      title: 'Changed',
      url: 'https://example.test'
    });
    const executor = new LocalCaptureExecutor(dependencies);

    await expect(executor.execute(session())).rejects.toThrow(
      '书签已发生变化'
    );
    expect(dependencies.commands.move).not.toHaveBeenCalled();
    expect(dependencies.commands.rename).not.toHaveBeenCalled();
  });
});

function createDependencies() {
  return {
    bookmarks: {
      get: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'bookmark')
          return {
            id: 'bookmark',
            parentId: 'source',
            index: 0,
            title: 'Original',
            url: 'https://example.test'
          };
        if (id === 'destination')
          return {
            id: 'destination',
            parentId: 'root',
            index: 0,
            title: 'AI'
          };
        return null;
      })
    },
    commands: {
      create: vi.fn().mockResolvedValue(operation('create', 'new-folder')),
      move: vi.fn().mockResolvedValue(operation('move')),
      rename: vi.fn().mockResolvedValue(operation('rename')),
      updateMetadata: vi.fn().mockResolvedValue(operation('metadata')),
      remove: vi.fn().mockResolvedValue(operation('remove'))
    },
    metadata: { get: vi.fn().mockResolvedValue(null) },
    specialFolders: {
      check: vi.fn().mockResolvedValue({
        ok: true,
        kind: 'inbox',
        folder: { id: 'inbox', parentId: 'root', index: 0, title: '收件箱' }
      })
    },
    undo: { undoBatch: vi.fn().mockResolvedValue({ completed: 3, failed: 0 }) },
    now: vi.fn().mockReturnValue(20),
    createId: vi.fn().mockReturnValue('batch-1')
  };
}

function session(patch: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: 'session',
    bookmarkId: 'bookmark',
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: 'bookmark',
      parentId: 'source',
      index: 0,
      title: 'Original',
      url: 'https://example.test'
    },
    state: 'pending',
    plan: plan(),
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 2,
    ...patch
  };
}

function plan(patch: Partial<NonNullable<CaptureSession['plan']>> = {}) {
  return {
    destination: {
      folderId: 'destination',
      path: [{ id: 'destination', title: 'AI' }],
      newFolders: []
    },
    title: 'Better title',
    tags: ['AI'],
    summary: 'Summary',
    confidence: 'high' as const,
    reason: 'Matches AI',
    relatedBookmarks: [],
    generatedAt: 1,
    ...patch
  };
}

function operation(
  type: OperationRecord['type'],
  bookmarkId = 'bookmark'
) {
  return ok({
    id: `${type}-operation`,
    type,
    bookmarkId,
    before: {},
    after: {},
    idempotencyKey: `${type}-key`,
    createdAt: 1
  } satisfies OperationRecord);
}
