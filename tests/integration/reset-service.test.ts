import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  ResetService,
  type ResetStorageArea
} from '../../src/settings/reset-service';
import { openSiftmarkDatabase } from '../../src/storage/database';

describe('ResetService', () => {
  it('previews exact thumbnail rows and blob bytes before clearing only that tier', async () => {
    const databaseName = 'siftmark-reset-thumbnail-test';
    const database = openSiftmarkDatabase(databaseName);
    try {
      await database.thumbnails.put({
        bookmarkId: 'b1',
        blob: { size: 3 } as Blob,
        state: 'ready',
        createdAt: 1,
        lastAccessedAt: 1
      });
      await database.bookmarkMetadata.put({
        bookmarkId: 'b1',
        summary: 'keep',
        tags: [],
        note: '',
        confidence: 'unknown',
        reason: '',
        health: 'unchecked',
        updatedAt: 1
      });
      const service = new ResetService(database, new MemoryResetStorage());

      expect(await service.preview('cache-thumbnails')).toEqual({
        scope: 'cache-thumbnails',
        rows: 1,
        bytes: 3,
        groups: [{ id: 'thumbnails', label: '缩略图缓存', rows: 1, bytes: 3 }],
        requiresConfirmation: false
      });

      expect(await service.execute('cache-thumbnails')).toEqual({
        ok: true,
        removedRows: 1,
        removedKeys: 0
      });
      expect(await database.thumbnails.count()).toBe(0);
      expect(await database.bookmarkMetadata.count()).toBe(1);
    } finally {
      database.close();
      await Dexie.delete(databaseName);
    }
  });

  it('requires the exact Chinese phrase before removing all Siftmark data', async () => {
    const databaseName = 'siftmark-reset-all-test';
    const database = openSiftmarkDatabase(databaseName);
    const storage = new MemoryResetStorage({
      'siftmark.ai.profiles.v1': 'secret',
      'siftmark.content.floating': true,
      unrelated: 'keep'
    });
    try {
      await database.bookmarkMetadata.put({
        bookmarkId: 'b1',
        summary: 'remove',
        tags: [],
        note: '',
        confidence: 'unknown',
        reason: '',
        health: 'unchecked',
        updatedAt: 1
      });
      await database.tasks.put({
        id: 'task',
        type: 'scan',
        state: 'queued',
        input: {},
        completed: 0,
        failed: 0,
        retryCount: 0,
        idempotencyKey: 'key',
        createdAt: 1,
        updatedAt: 1
      });
      const service = new ResetService(database, storage);

      const preview = await service.preview('all-siftmark-data');
      expect(preview).toMatchObject({
        scope: 'all-siftmark-data',
        rows: 4,
        requiresConfirmation: true
      });
      expect(preview.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'bookmarkMetadata', rows: 1 }),
          expect.objectContaining({ id: 'tasks', rows: 1 }),
          expect.objectContaining({ id: 'local-storage', rows: 2, bytes: 10 })
        ])
      );

      expect(
        await service.execute('all-siftmark-data', {
          confirmationPhrase: 'reset'
        })
      ).toEqual({
        ok: false,
        code: 'confirmation-required'
      });
      expect(await database.bookmarkMetadata.count()).toBe(1);

      expect(
        await service.execute('all-siftmark-data', {
          confirmationPhrase: '重置 Siftmark'
        })
      ).toEqual({
        ok: true,
        removedRows: 2,
        removedKeys: 2
      });
      expect(
        (
          await Promise.all(database.tables.map((table) => table.count()))
        ).every((count) => count === 0)
      ).toBe(true);
      expect(await storage.get(null)).toEqual({ unrelated: 'keep' });
    } finally {
      database.close();
      await Dexie.delete(databaseName);
    }
  });

  it('keeps AI, history, and model reset tiers isolated', async () => {
    const databaseName = 'siftmark-reset-tiers-test';
    const database = openSiftmarkDatabase(databaseName);
    const storage = new MemoryResetStorage({
      'siftmark.ai.profiles.v1': [{ id: 'p1' }],
      'siftmark.settings.profile-assignments.v1': { classify: 'p1@1' },
      'siftmark.settings.appearance.v1': { theme: 'dark' }
    });
    try {
      await database.bookmarkMetadata.put({
        bookmarkId: 'b1',
        summary: 'remove',
        tags: [],
        note: '',
        confidence: 'unknown',
        reason: '',
        health: 'unchecked',
        updatedAt: 1
      });
      await database.searchIndex.put({
        id: 'keyword:b1',
        kind: 'keyword',
        bookmarkId: 'b1',
        keywordTokens: ['a'],
        updatedAt: 1
      });
      await database.operationLog.put({
        id: 'op',
        type: 'move',
        bookmarkId: 'b1',
        before: {},
        after: {},
        idempotencyKey: 'op-key',
        createdAt: 1
      });
      await database.tasks.put({
        id: 'task',
        type: 'scan',
        state: 'queued',
        input: {},
        completed: 0,
        failed: 0,
        retryCount: 0,
        idempotencyKey: 'task-key',
        createdAt: 1,
        updatedAt: 1
      });
      const service = new ResetService(database, storage);

      expect(
        (await service.preview('ai-metadata-index')).groups.map(
          (group) => group.id
        )
      ).toEqual(['bookmarkMetadata', 'searchIndex']);
      await service.execute('ai-metadata-index');
      expect(await database.bookmarkMetadata.count()).toBe(0);
      expect(await database.searchIndex.count()).toBe(0);
      expect(await database.operationLog.count()).toBe(1);

      await service.execute('history-tasks');
      expect(await database.operationLog.count()).toBe(0);
      expect(await database.tasks.count()).toBe(0);
      expect(
        (await storage.get('siftmark.ai.profiles.v1'))[
          'siftmark.ai.profiles.v1'
        ]
      ).toBeDefined();

      expect(await service.execute('model-configuration')).toEqual({
        ok: true,
        removedRows: 0,
        removedKeys: 2
      });
      expect(await storage.get(null)).toEqual({
        'siftmark.settings.appearance.v1': { theme: 'dark' }
      });
    } finally {
      database.close();
      await Dexie.delete(databaseName);
    }
  });
});

class MemoryResetStorage implements ResetStorageArea {
  private readonly values: Record<string, unknown>;

  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }

  async get(keys: string | string[] | null) {
    if (keys === null) return { ...this.values };
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.map((key) => [key, this.values[key]]));
  }

  async remove(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys])
      delete this.values[key];
  }
}
