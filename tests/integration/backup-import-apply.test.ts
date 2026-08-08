import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { BookmarkRepository } from '../../src/bookmarks/ports';
import type { BookmarkNode } from '../../src/bookmarks/types';
import {
  applyImportPlan,
  createImportTask,
  DexieImportRecoveryRepository
} from '../../src/backup/import-application-service';
import { createImportPlan } from '../../src/backup/import-plan';
import type { ImportGraph } from '../../src/backup/types';
import { BookmarkCommandService } from '../../src/operations/bookmark-command-service';
import { DexieOperationRepository } from '../../src/operations/operation-repository';
import { UndoService } from '../../src/operations/undo-service';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { DexieMetadataRepository } from '../../src/storage/metadata-repository';
import { DexieTaskRepository } from '../../src/tasks/task-repository';

const databaseName = 'siftmark-backup-import-test';

afterEach(async () => Dexie.delete(databaseName));

describe('backup import application', () => {
  it('creates a recovery point before applying nodes in parent-first order', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const bookmarks = new MemoryBookmarks([
      { id: 'root', parentId: '0', index: 0, title: '书签栏' }
    ]);
    const operations = new DexieOperationRepository(database);
    const metadata = new DexieMetadataRepository(database);
    const tasks = new DexieTaskRepository(database);
    const recoveries = new DexieImportRecoveryRepository(database);
    const commands = new BookmarkCommandService(
      bookmarks,
      operations,
      metadata,
      () => 10,
      sequentialIds('operation')
    );
    const plan = createImportPlan(nestedGraph(), [], {}, 'root', 'plan-1');
    const task = createImportTask(plan, 1, 'task-1');
    await tasks.put(task);

    const result = await applyImportPlan('task-1', {
      bookmarks,
      commands,
      metadata,
      tasks,
      recoveryPoints: recoveries,
      now: () => 20,
      createId: sequentialIds('recovery')
    });

    expect(result).toMatchObject({
      state: 'succeeded',
      completed: 2,
      failed: 0
    });
    expect(bookmarks.created).toEqual([
      { parentId: 'root', index: 0, title: '开发' },
      {
        parentId: 'created-1',
        index: 0,
        title: 'Siftmark',
        url: 'https://example.com'
      }
    ]);
    expect(await tasks.get('task-1')).toMatchObject({
      state: 'succeeded',
      completed: 2
    });
    expect(await recoveries.list()).toEqual([
      expect.objectContaining({
        id: 'recovery-1',
        nodes: [{ id: 'root', parentId: '0', index: 0, title: '书签栏' }]
      })
    ]);
    const createdOperations = await operations.listRecent(10);
    const bookmarkOperation = createdOperations.find(
      (operation) => operation.after.title === 'Siftmark'
    );
    const folderOperation = createdOperations.find(
      (operation) => operation.after.title === '开发'
    );
    expect(bookmarkOperation && folderOperation).toBeTruthy();
    const undo = new UndoService(bookmarks, operations, metadata, () => 30);
    expect((await undo.undo(bookmarkOperation!.id)).ok).toBe(true);
    expect((await undo.undo(folderOperation!.id)).ok).toBe(true);
    expect(await bookmarks.get('created-1')).toBeNull();
    expect(await bookmarks.get('created-2')).toBeNull();
    await database.close();
  });

  it('keeps partial failures reviewable and resumes without duplicating completed parents', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const bookmarks = new MemoryBookmarks([
      { id: 'root', parentId: '0', index: 0, title: '书签栏' }
    ]);
    bookmarks.failNextCreate('Siftmark');
    const operations = new DexieOperationRepository(database);
    const metadata = new DexieMetadataRepository(database);
    const tasks = new DexieTaskRepository(database);
    const recoveries = new DexieImportRecoveryRepository(database);
    const commands = new BookmarkCommandService(
      bookmarks,
      operations,
      metadata,
      () => 10,
      sequentialIds('operation')
    );
    const plan = createImportPlan(nestedGraph(), [], {}, 'root', 'plan-resume');
    await tasks.put(createImportTask(plan, 1, 'task-resume'));
    const dependencies = {
      bookmarks,
      commands,
      metadata,
      tasks,
      recoveryPoints: recoveries,
      now: () => 20,
      createId: sequentialIds('recovery')
    };

    const paused = await applyImportPlan('task-resume', dependencies);
    expect(paused).toMatchObject({
      state: 'paused',
      completed: 1,
      failed: 1,
      input: { nextIndex: 1, failures: [{ sourceId: 'bookmark' }] }
    });

    const resumed = await applyImportPlan('task-resume', dependencies);
    expect(resumed).toMatchObject({
      state: 'succeeded',
      completed: 2,
      failed: 1
    });
    expect(
      bookmarks.created.filter((node) => node.title === '开发')
    ).toHaveLength(1);
    expect(
      bookmarks.created.filter((node) => node.title === 'Siftmark')
    ).toHaveLength(1);
    expect(await recoveries.list()).toHaveLength(1);
    await database.close();
  });

  it('adopts an in-flight native create after a crash instead of creating a duplicate', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const bookmarks = new MemoryBookmarks([
      { id: 'root', parentId: '0', index: 0, title: '书签栏' },
      { id: 'orphan-folder', parentId: 'root', index: 0, title: '开发' }
    ]);
    const operations = new DexieOperationRepository(database);
    const metadata = new DexieMetadataRepository(database);
    const tasks = new DexieTaskRepository(database);
    const recoveries = new DexieImportRecoveryRepository(database);
    await recoveries.put({
      id: 'recovery-crash',
      createdAt: 1,
      nodes: [{ id: 'root', parentId: '0', index: 0, title: '书签栏' }],
      metadata: []
    });
    const plan = createImportPlan(nestedGraph(), [], {}, 'root', 'plan-crash');
    const task = createImportTask(plan, 1, 'task-crash');
    task.input = {
      ...task.input,
      recoveryPointId: 'recovery-crash',
      inFlightSourceId: 'folder'
    };
    await tasks.put(task);

    const result = await applyImportPlan('task-crash', {
      bookmarks,
      commands: new BookmarkCommandService(
        bookmarks,
        operations,
        metadata,
        () => 10,
        sequentialIds('operation')
      ),
      metadata,
      tasks,
      recoveryPoints: recoveries,
      now: () => 20
    });

    expect(result.state).toBe('succeeded');
    expect(bookmarks.created).toEqual([
      {
        parentId: 'orphan-folder',
        index: 0,
        title: 'Siftmark',
        url: 'https://example.com'
      }
    ]);
    expect(
      (await operations.listRecent(10)).filter(
        (operation) => operation.type === 'create'
      )
    ).toHaveLength(2);
    await database.close();
  });
});

function nestedGraph(): ImportGraph {
  return {
    format: 'siftmark',
    version: 1,
    nodes: [
      {
        sourceId: 'folder',
        kind: 'folder',
        parentSourceId: null,
        title: '开发',
        index: 0
      },
      {
        sourceId: 'bookmark',
        kind: 'bookmark',
        parentSourceId: 'folder',
        title: 'Siftmark',
        url: 'https://example.com',
        index: 0
      }
    ],
    operations: [],
    settings: {},
    history: [],
    blockedDomains: [],
    unknownFields: [],
    integrity: 'verified',
    keyPresence: 'none',
    thumbnailBytes: 0
  };
}

class MemoryBookmarks implements BookmarkRepository {
  readonly created: Array<Omit<BookmarkNode, 'id'>> = [];
  private nextId = 1;
  private failingTitle: string | null = null;

  constructor(private readonly nodes: BookmarkNode[]) {}

  failNextCreate(title: string): void {
    this.failingTitle = title;
  }

  async get(id: string): Promise<BookmarkNode | null> {
    return this.nodes.find((node) => node.id === id) ?? null;
  }

  async getTree(): Promise<BookmarkNode[]> {
    return this.nodes.map((node) => ({ ...node }));
  }

  async create(input: Omit<BookmarkNode, 'id'>): Promise<BookmarkNode> {
    if (this.failingTitle === input.title) {
      this.failingTitle = null;
      throw new Error('simulated-create-failure');
    }
    this.created.push({ ...input });
    const node = { id: `created-${this.nextId++}`, ...input };
    this.nodes.push(node);
    return node;
  }

  async update(
    id: string,
    patch: Pick<BookmarkNode, 'title'>
  ): Promise<BookmarkNode> {
    const node = await this.require(id);
    Object.assign(node, patch);
    return { ...node };
  }

  async move(
    id: string,
    parentId: string,
    index?: number
  ): Promise<BookmarkNode> {
    const node = await this.require(id);
    node.parentId = parentId;
    if (index !== undefined) node.index = index;
    return { ...node };
  }

  async remove(id: string): Promise<void> {
    const index = this.nodes.findIndex((node) => node.id === id);
    if (index >= 0) this.nodes.splice(index, 1);
  }

  private async require(id: string): Promise<BookmarkNode> {
    const node = this.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`missing:${id}`);
    return node;
  }
}

function sequentialIds(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}-${next++}`;
}
