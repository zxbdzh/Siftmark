import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openSiftmarkDatabase } from '../../../src/storage/database';
import { VisitAggregator } from '../../../src/health/visit-aggregator';

const databaseName = 'siftmark-visit-aggregator-test';

describe('VisitAggregator', () => {
  afterEach(async () => Dexie.delete(databaseName));

  it('collapses visits into daily buckets and keeps only the latest 90 days', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const aggregator = new VisitAggregator(database);
    const now = Date.UTC(2026, 7, 8, 12);
    await aggregator.record('bookmark', now - 100 * 86_400_000);
    await aggregator.record('bookmark', now);
    await aggregator.record('bookmark', now + 1_000);
    const row = await database.visitAggregates.get('bookmark');
    expect(row).toEqual(expect.objectContaining({ bookmarkId: 'bookmark', count: 2, lastVisitedAt: now + 1_000, dailyBuckets: { '2026-08-08': 2 } }));
    expect(row).not.toHaveProperty('url');
    await database.close();
  });
});
