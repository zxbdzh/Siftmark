import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openSiftmarkDatabase } from '../../../src/storage/database';
import { DexieMetadataRepository } from '../../../src/storage/metadata-repository';

describe('DexieMetadataRepository', () => {
  afterEach(async () => {
    await Dexie.delete('siftmark-test');
  });

  it('soft deletes and restores metadata without losing fields', async () => {
    const db = openSiftmarkDatabase('siftmark-test');
    const repo = new DexieMetadataRepository(db);
    await repo.put({ bookmarkId: 'b1', summary: 'summary', tags: ['AI'], note: '', confidence: 'high', reason: 'rule', health: 'unchecked', updatedAt: 1 });
    await repo.softDelete('b1', 2);
    expect(await repo.get('b1')).toBeNull();
    await repo.restore('b1');
    expect((await repo.get('b1'))?.summary).toBe('summary');
    await db.close();
  });

  it('purges only rows older than the cutoff', async () => {
    const db = openSiftmarkDatabase('siftmark-test');
    const repo = new DexieMetadataRepository(db);
    await repo.put({ bookmarkId: 'old', summary: '', tags: [], note: '', confidence: 'unknown', reason: '', health: 'unchecked', updatedAt: 1 });
    await repo.put({ bookmarkId: 'new', summary: '', tags: [], note: '', confidence: 'unknown', reason: '', health: 'unchecked', updatedAt: 1 });
    await repo.softDelete('old', 1);
    await repo.softDelete('new', 10);
    expect(await repo.purgeDeletedBefore(5)).toBe(1);
    expect(await db.softDeletedMetadata.get('new')).toBeDefined();
    await db.close();
  });
});
