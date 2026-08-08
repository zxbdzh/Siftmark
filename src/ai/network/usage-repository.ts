import type { SiftmarkDatabase } from '../../storage/database';
import type { RequestMetric } from './request-metrics';

const MAX_ROWS = 1_000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export class UsageRepository {
  constructor(private readonly db: SiftmarkDatabase) {}

  async add(metric: RequestMetric): Promise<void> {
    await this.db.transaction('rw', this.db.aiUsageLog, async () => {
      await this.db.aiUsageLog.put(metric);
      await this.db.aiUsageLog.where('createdAt').below(Date.now() - MAX_AGE_MS).delete();
      const count = await this.db.aiUsageLog.count();
      if (count > MAX_ROWS) {
        const oldest = await this.db.aiUsageLog.orderBy('createdAt').limit(count - MAX_ROWS).primaryKeys();
        await this.db.aiUsageLog.bulkDelete(oldest as string[]);
      }
    });
  }
}
