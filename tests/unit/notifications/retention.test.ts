import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationRepository } from '../../../src/notifications/notification-repository';
import { openSiftmarkDatabase } from '../../../src/storage/database';

const databaseName = 'siftmark-notification-retention-test';

describe('notification retention', () => {
  afterEach(async () => Dexie.delete(databaseName));

  it('expires rows after 30 days and evicts oldest read rows first above 500', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const repository = new NotificationRepository(database);
    const now = Date.UTC(2026, 7, 8);
    await repository.put({ id: 'expired', type: 'info', title: '旧', message: '', read: false, createdAt: now - 31 * 86_400_000 });
    for (let index = 0; index < 501; index += 1) await repository.put({ id: `row-${index}`, type: 'info', title: `${index}`, message: '', read: index === 10, createdAt: now - 1_000 + index });
    expect(await repository.enforceRetention(now)).toBe(2);
    expect(await database.notifications.get('expired')).toBeUndefined();
    expect(await database.notifications.get('row-10')).toBeUndefined();
    expect(await database.notifications.count()).toBe(500);
    await database.close();
  });
});
