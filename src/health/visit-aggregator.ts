import type { SiftmarkDatabase } from '../storage/database';
import type { VisitAggregate } from '../storage/schema';

const RETENTION_DAYS = 90;

export class VisitAggregator {
  constructor(private readonly db: SiftmarkDatabase) {}

  async record(bookmarkId: string, visitedAt: number): Promise<VisitAggregate> {
    const current = await this.db.visitAggregates.get(bookmarkId);
    const dailyBuckets = pruneBuckets({ ...(current?.dailyBuckets ?? {}), [dayKey(visitedAt)]: (current?.dailyBuckets[dayKey(visitedAt)] ?? 0) + 1 }, visitedAt);
    const aggregate: VisitAggregate = { bookmarkId, count: Object.values(dailyBuckets).reduce((sum, count) => sum + count, 0), lastVisitedAt: Math.max(current?.lastVisitedAt ?? 0, visitedAt), dailyBuckets };
    await this.db.visitAggregates.put(aggregate);
    return aggregate;
  }

  async prune(now: number): Promise<number> {
    const rows = await this.db.visitAggregates.toArray();
    let changed = 0;
    for (const row of rows) {
      const dailyBuckets = pruneBuckets(row.dailyBuckets, now);
      if (Object.keys(dailyBuckets).length === Object.keys(row.dailyBuckets).length) continue;
      changed += 1;
      await this.db.visitAggregates.put({ ...row, count: Object.values(dailyBuckets).reduce((sum, count) => sum + count, 0), dailyBuckets });
    }
    return changed;
  }
}

function pruneBuckets(buckets: Record<string, number>, now: number): Record<string, number> {
  const cutoff = dayKey(now - (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000);
  return Object.fromEntries(Object.entries(buckets).filter(([day]) => day >= cutoff));
}

function dayKey(timestamp: number): string { return new Date(timestamp).toISOString().slice(0, 10); }
