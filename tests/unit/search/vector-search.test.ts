import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openSiftmarkDatabase } from '../../../src/storage/database';
import { EmbeddingRepository } from '../../../src/search/embedding/embedding-repository';
import { VectorSearch } from '../../../src/search/embedding/vector-search';

const databaseName = 'siftmark-vector-search-test';

describe('VectorSearch', () => {
  afterEach(async () => Dexie.delete(databaseName));

  it('never compares vectors from different profile versions or dimensions', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const repository = new EmbeddingRepository(database);
    await repository.put({ bookmarkId: 'a', key: { profileId: 'p1', vectorVersion: 'v1', dimensions: 3 }, values: [1, 0, 0], inputHash: 'a', stale: false, updatedAt: 1 });
    await repository.put({ bookmarkId: 'b', key: { profileId: 'p1', vectorVersion: 'v2', dimensions: 3 }, values: [1, 0, 0], inputHash: 'b', stale: false, updatedAt: 1 });
    await repository.put({ bookmarkId: 'c', key: { profileId: 'p2', vectorVersion: 'v1', dimensions: 2 }, values: [1, 0], inputHash: 'c', stale: false, updatedAt: 1 });

    const results = await new VectorSearch(repository).query([1, 0, 0], { profileId: 'p1', vectorVersion: 'v1', dimensions: 3 });
    expect(results).toEqual([{ bookmarkId: 'a', score: 1 }]);
    await database.close();
  });
});
