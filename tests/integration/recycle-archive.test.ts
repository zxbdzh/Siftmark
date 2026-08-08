import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import type { BookmarkRepository } from '../../src/bookmarks/ports';
import type { BookmarkNode } from '../../src/bookmarks/types';
import {
  RecycleService,
  type SpecialFolderPlacement,
  type SpecialFolderPlacementRepository
} from '../../src/bookmarks/recycle-service';
import { BookmarkCommandService } from '../../src/operations/bookmark-command-service';
import type { OperationRepository } from '../../src/operations/operation-repository';
import type { OperationRecord } from '../../src/operations/types';
import { SpecialFolderService } from '../../src/bookmarks/special-folders';
import { ArchiveService } from '../../src/bookmarks/archive-service';
import { createPurgeRecycleBinHandler } from '../../src/tasks/handlers/purge-recycle-bin';
import type { MetadataRepository } from '../../src/storage/types';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { DexieSpecialFolderPlacementRepository } from '../../src/bookmarks/placement-repository';
import { UndoService } from '../../src/operations/undo-service';

describe('recycle and archive workflows', () => {
  it('records the original location before moving an item to the bound recycle bin', async () => {
    const bookmarks = new MemoryBookmarks(defaultNodes());
    const settings = new MemorySettings({ recycleBinId: 'recycle' });
    const placements = new MemoryPlacements();
    const operations = new MemoryOperations();
    const commands = new BookmarkCommandService(
      bookmarks,
      operations,
      undefined,
      () => 1_000,
      sequence('operation', 'idempotency')
    );
    const service = new RecycleService(
      bookmarks,
      commands,
      new SpecialFolderService(bookmarks, settings),
      placements,
      () => 1_000
    );

    const result = await service.recycle('bookmark');

    expect(result).toMatchObject({
      ok: true,
      destination: { id: 'recycle', title: '回收站' },
      originalLocation: { parentId: 'work', index: 3 }
    });
    expect(await bookmarks.get('bookmark')).toMatchObject({
      parentId: 'recycle'
    });
    expect(await placements.get('bookmark')).toEqual({
      bookmarkId: 'bookmark',
      state: 'recycled',
      originalParentId: 'work',
      originalIndex: 3,
      destinationFolderId: 'recycle',
      movedAt: 1_000
    });
  });

  it('restores a recycled item to its original parent and index', async () => {
    const bookmarks = new MemoryBookmarks(defaultNodes());
    const placements = new MemoryPlacements();
    const operations = new MemoryOperations();
    const commands = new BookmarkCommandService(
      bookmarks,
      operations,
      undefined,
      () => 1_000,
      sequence(
        'recycle-operation',
        'recycle-key',
        'restore-operation',
        'restore-key'
      )
    );
    const service = new RecycleService(
      bookmarks,
      commands,
      new SpecialFolderService(
        bookmarks,
        new MemorySettings({ recycleBinId: 'recycle' })
      ),
      placements,
      () => 1_000
    );
    await service.recycle('bookmark');

    const result = await service.restore('bookmark');

    expect(result).toMatchObject({
      ok: true,
      destination: { id: 'work', title: '工作' },
      originalLocation: { parentId: 'work', index: 3 }
    });
    expect(await bookmarks.get('bookmark')).toMatchObject({
      parentId: 'work',
      index: 3
    });
    expect(await placements.get('bookmark')).toBeNull();
  });

  it('archives an item through the bound archive folder and records its origin', async () => {
    const bookmarks = new MemoryBookmarks(defaultNodes());
    const placements = new MemoryPlacements();
    const commands = new BookmarkCommandService(
      bookmarks,
      new MemoryOperations(),
      undefined,
      () => 2_000,
      sequence('archive-operation', 'archive-key')
    );
    const service = new ArchiveService(
      bookmarks,
      commands,
      new SpecialFolderService(
        bookmarks,
        new MemorySettings({ archiveId: 'archive' })
      ),
      placements,
      () => 2_000
    );

    const result = await service.archive('bookmark');

    expect(result).toMatchObject({
      ok: true,
      destination: { id: 'archive', title: '归档' },
      originalLocation: { parentId: 'work', index: 3 }
    });
    expect(await placements.get('bookmark')).toMatchObject({
      state: 'archived',
      destinationFolderId: 'archive',
      movedAt: 2_000
    });
  });

  it('restores an archived item to its recorded location', async () => {
    const bookmarks = new MemoryBookmarks(defaultNodes());
    const placements = new MemoryPlacements();
    const service = new ArchiveService(
      bookmarks,
      new BookmarkCommandService(
        bookmarks,
        new MemoryOperations(),
        undefined,
        () => 2_000,
        sequence(
          'archive-operation',
          'archive-key',
          'restore-operation',
          'restore-key'
        )
      ),
      new SpecialFolderService(
        bookmarks,
        new MemorySettings({ archiveId: 'archive' })
      ),
      placements,
      () => 2_000
    );
    await service.archive('bookmark');

    const result = await service.restore('bookmark');

    expect(result).toMatchObject({
      ok: true,
      destination: { id: 'work' },
      originalLocation: { parentId: 'work', index: 3 }
    });
    expect(await bookmarks.get('bookmark')).toMatchObject({
      parentId: 'work',
      index: 3
    });
    expect(await placements.get('bookmark')).toBeNull();
  });

  it('purges only items that have remained in the recycle bin for more than 30 days', async () => {
    const day = 24 * 60 * 60 * 1_000;
    const bookmarks = new MemoryBookmarks([
      ...defaultNodes(),
      {
        id: 'old',
        parentId: 'recycle',
        index: 0,
        title: '旧书签',
        url: 'https://old.example'
      },
      {
        id: 'recent',
        parentId: 'recycle',
        index: 1,
        title: '新书签',
        url: 'https://new.example'
      }
    ]);
    const placements = new MemoryPlacements();
    await placements.put({
      bookmarkId: 'old',
      state: 'recycled',
      originalParentId: 'work',
      originalIndex: 0,
      destinationFolderId: 'recycle',
      movedAt: 0
    });
    await placements.put({
      bookmarkId: 'recent',
      state: 'recycled',
      originalParentId: 'work',
      originalIndex: 1,
      destinationFolderId: 'recycle',
      movedAt: 12 * day
    });
    const deletedMetadata: string[] = [];
    const metadata = {
      softDelete: async (bookmarkId: string) => {
        deletedMetadata.push(bookmarkId);
      }
    } as unknown as MetadataRepository;
    const progress: Array<{ completed: number; failed: number }> = [];
    const handler = createPurgeRecycleBinHandler({
      bookmarks,
      placements,
      specialFolders: new SpecialFolderService(
        bookmarks,
        new MemorySettings({ recycleBinId: 'recycle' })
      ),
      metadata,
      now: () => 40 * day
    });

    const result = await handler({
      task: {
        id: 'purge',
        type: 'purge-recycle-bin',
        state: 'running',
        input: {},
        completed: 0,
        failed: 0,
        retryCount: 0,
        idempotencyKey: 'purge-key',
        createdAt: 0,
        updatedAt: 0
      },
      signal: new AbortController().signal,
      reportProgress: async (value) => {
        progress.push(value);
      }
    });

    expect(result).toEqual({ state: 'succeeded', completed: 1, failed: 0 });
    expect(await bookmarks.get('old')).toBeNull();
    expect(await bookmarks.get('recent')).not.toBeNull();
    expect(deletedMetadata).toEqual(['old']);
    expect(progress.at(-1)).toEqual({ completed: 1, failed: 0 });
  });

  it('persists placement records and filters expired recycled items', async () => {
    const databaseName = 'siftmark-special-folder-placement-test';
    const database = openSiftmarkDatabase(databaseName);
    const placements = new DexieSpecialFolderPlacementRepository(database);
    try {
      await placements.put({
        bookmarkId: 'recycled',
        state: 'recycled',
        originalParentId: 'work',
        originalIndex: 1,
        destinationFolderId: 'recycle',
        movedAt: 10
      });
      await placements.put({
        bookmarkId: 'archived',
        state: 'archived',
        originalParentId: 'work',
        originalIndex: 2,
        destinationFolderId: 'archive',
        movedAt: 5
      });

      expect(await placements.get('recycled')).toMatchObject({
        state: 'recycled',
        originalParentId: 'work'
      });
      expect(await placements.listRecycledBefore(11)).toEqual([
        expect.objectContaining({ bookmarkId: 'recycled' })
      ]);
    } finally {
      database.close();
      await Dexie.delete(databaseName);
    }
  });

  it('undoes a recycle move without leaving a stale recycled state', async () => {
    const bookmarks = new MemoryBookmarks(defaultNodes());
    const placements = new MemoryPlacements();
    const operations = new MemoryOperations();
    const service = new RecycleService(
      bookmarks,
      new BookmarkCommandService(
        bookmarks,
        operations,
        undefined,
        () => 3_000,
        sequence('recycle-operation', 'recycle-key')
      ),
      new SpecialFolderService(
        bookmarks,
        new MemorySettings({ recycleBinId: 'recycle' })
      ),
      placements,
      () => 3_000
    );
    const recycled = await service.recycle('bookmark');
    if (!recycled.ok) throw new Error('Expected recycle to succeed');

    const undone = await new UndoService(
      bookmarks,
      operations,
      undefined,
      () => 4_000,
      placements
    ).undo(recycled.operation.id);

    expect(undone.ok).toBe(true);
    expect(await bookmarks.get('bookmark')).toMatchObject({
      parentId: 'work',
      index: 3
    });
    expect(await placements.get('bookmark')).toBeNull();
  });

  it('requires an explicit destination when the original parent no longer exists', async () => {
    const bookmarks = new MemoryBookmarks(defaultNodes());
    const placements = new MemoryPlacements();
    const service = new RecycleService(
      bookmarks,
      new BookmarkCommandService(
        bookmarks,
        new MemoryOperations(),
        undefined,
        () => 5_000,
        sequence(
          'recycle-operation',
          'recycle-key',
          'restore-operation',
          'restore-key'
        )
      ),
      new SpecialFolderService(
        bookmarks,
        new MemorySettings({ recycleBinId: 'recycle' })
      ),
      placements,
      () => 5_000
    );
    await service.recycle('bookmark');
    await bookmarks.remove('work');

    expect(await service.restore('bookmark')).toEqual({
      ok: false,
      error: { code: 'destination-required', originalParentId: 'work' }
    });
    expect(await bookmarks.get('bookmark')).toMatchObject({
      parentId: 'recycle'
    });

    expect(await service.restore('bookmark', 'archive')).toMatchObject({
      ok: true,
      destination: { id: 'archive' }
    });
    expect(await bookmarks.get('bookmark')).toMatchObject({
      parentId: 'archive'
    });
  });

  it('undoes a restore by reinstating the recycled placement state', async () => {
    const bookmarks = new MemoryBookmarks(defaultNodes());
    const placements = new MemoryPlacements();
    const operations = new MemoryOperations();
    const service = new RecycleService(
      bookmarks,
      new BookmarkCommandService(
        bookmarks,
        operations,
        undefined,
        () => 6_000,
        sequence(
          'recycle-operation',
          'recycle-key',
          'restore-operation',
          'restore-key'
        )
      ),
      new SpecialFolderService(
        bookmarks,
        new MemorySettings({ recycleBinId: 'recycle' })
      ),
      placements,
      () => 6_000
    );
    await service.recycle('bookmark');
    const restored = await service.restore('bookmark');
    if (!restored.ok) throw new Error('Expected restore to succeed');

    await new UndoService(
      bookmarks,
      operations,
      undefined,
      () => 7_000,
      placements
    ).undo(restored.operation.id);

    expect(await bookmarks.get('bookmark')).toMatchObject({
      parentId: 'recycle'
    });
    expect(await placements.get('bookmark')).toMatchObject({
      state: 'recycled'
    });
  });
});

function defaultNodes(): BookmarkNode[] {
  return [
    { id: 'work', parentId: '0', index: 0, title: '工作' },
    { id: 'archive', parentId: '0', index: 1, title: '归档' },
    { id: 'recycle', parentId: '0', index: 2, title: '回收站' },
    {
      id: 'bookmark',
      parentId: 'work',
      index: 3,
      title: '文档',
      url: 'https://example.com'
    }
  ];
}

class MemoryBookmarks implements BookmarkRepository {
  private readonly nodes = new Map<string, BookmarkNode>();

  constructor(nodes: BookmarkNode[]) {
    for (const node of nodes) this.nodes.set(node.id, { ...node });
  }

  async get(id: string) {
    return this.nodes.get(id) ?? null;
  }
  async getTree() {
    return [...this.nodes.values()];
  }
  async create(input: Omit<BookmarkNode, 'id'>) {
    const node = { ...input, id: `created-${this.nodes.size}` };
    this.nodes.set(node.id, node);
    return node;
  }
  async update(id: string, patch: Pick<BookmarkNode, 'title'>) {
    const updated = { ...this.require(id), ...patch };
    this.nodes.set(id, updated);
    return updated;
  }
  async move(id: string, parentId: string, index = 0) {
    const moved = { ...this.require(id), parentId, index };
    this.nodes.set(id, moved);
    return moved;
  }
  async remove(id: string) {
    this.nodes.delete(id);
  }
  private require(id: string) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Missing bookmark ${id}`);
    return node;
  }
}

class MemorySettings {
  constructor(private value: Record<string, string | undefined>) {}
  async getSpecialFolders() {
    return { ...this.value };
  }
  async setSpecialFolders(value: Record<string, string | undefined>) {
    this.value = { ...value };
  }
}

class MemoryPlacements implements SpecialFolderPlacementRepository {
  private readonly rows = new Map<string, SpecialFolderPlacement>();
  async get(bookmarkId: string) {
    return this.rows.get(bookmarkId) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async put(value: SpecialFolderPlacement) {
    this.rows.set(value.bookmarkId, value);
  }
  async delete(bookmarkId: string) {
    this.rows.delete(bookmarkId);
  }
  async listRecycledBefore(cutoff: number) {
    return [...this.rows.values()].filter(
      (row) => row.state === 'recycled' && row.movedAt < cutoff
    );
  }
}

class MemoryOperations implements OperationRepository {
  private readonly rows = new Map<string, OperationRecord>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async getByIdempotencyKey(key: string) {
    return (
      [...this.rows.values()].find((row) => row.idempotencyKey === key) ?? null
    );
  }
  async listRecent(limit = 20) {
    return [...this.rows.values()].slice(-limit).reverse();
  }
  async put(value: OperationRecord) {
    this.rows.set(value.id, value);
  }
  async markUndone(id: string, undoneAt: number) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, undoneAt });
  }
}

function sequence(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}
