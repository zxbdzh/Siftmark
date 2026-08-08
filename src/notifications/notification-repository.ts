import type { SiftmarkDatabase } from '../storage/database';
import type { NotificationRecord } from '../storage/schema';
import type { AppNotification } from './types';

const MAX_ROWS = 500;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class NotificationRepository {
  constructor(private readonly db: SiftmarkDatabase) {}

  list(type?: string): Promise<AppNotification[]> {
    const query = type ? this.db.notifications.where('type').equals(type) : this.db.notifications.orderBy('createdAt');
    return query.reverse().toArray() as unknown as Promise<AppNotification[]>;
  }

  async put(notification: AppNotification): Promise<void> {
    await this.db.notifications.put(notification as NotificationRecord);
  }

  async markRead(id: string, read = true): Promise<void> { await this.db.notifications.update(id, { read }); }
  async clear(): Promise<void> { await this.db.notifications.clear(); }

  async enforceRetention(now: number): Promise<number> {
    const expired = await this.db.notifications.where('createdAt').below(now - RETENTION_MS).primaryKeys();
    if (expired.length > 0) await this.db.notifications.bulkDelete(expired);
    const rows = await this.db.notifications.orderBy('createdAt').toArray();
    const overflow = Math.max(0, rows.length - MAX_ROWS);
    if (overflow === 0) return expired.length;
    const evictionOrder = [...rows.filter((row) => row.read), ...rows.filter((row) => !row.read)].slice(0, overflow);
    await this.db.notifications.bulkDelete(evictionOrder.map((row) => row.id));
    return expired.length + evictionOrder.length;
  }
}
