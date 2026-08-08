import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { DexieTaskRepository } from '../../src/tasks/task-repository';
import { recoverInterruptedTasks } from '../../src/tasks/task-recovery';
import type { DurableTask } from '../../src/tasks/types';

function makeTask(patch: Partial<DurableTask> = {}): DurableTask {
  return {
    id: 'task-1',
    type: 'local-index',
    state: 'running',
    input: {},
    profileVersion: 'v1',
    completed: 0,
    failed: 0,
    retryCount: 0,
    idempotencyKey: 'key',
    createdAt: 1,
    updatedAt: 1,
    ...patch
  };
}

describe('task recovery', () => {
  afterEach(async () => Dexie.delete('siftmark-task-test'));

  it('marks an interrupted analysis request as unknown', async () => {
    const db = openSiftmarkDatabase('siftmark-task-test');
    const tasks = new DexieTaskRepository(db);
    await tasks.put(makeTask({ type: 'analyze-bookmark' }));
    await recoverInterruptedTasks(tasks, 10_000);
    expect(await tasks.get('task-1')).toMatchObject({
      state: 'unknown',
      profileVersion: 'v1'
    });
    await db.close();
  });

  it('returns idempotent local work to the queue and leaves cancelled work alone', async () => {
    const db = openSiftmarkDatabase('siftmark-task-test');
    const tasks = new DexieTaskRepository(db);
    await tasks.put(makeTask());
    await tasks.put(makeTask({ id: 'cancelled', state: 'cancelled' }));
    await recoverInterruptedTasks(tasks, 10_000);
    expect((await tasks.get('task-1'))?.state).toBe('queued');
    expect((await tasks.get('cancelled'))?.state).toBe('cancelled');
    await db.close();
  });

  it('allows only one repository to claim a queued task', async () => {
    const db = openSiftmarkDatabase('siftmark-task-test');
    const first = new DexieTaskRepository(db);
    const second = new DexieTaskRepository(db);
    await first.put(makeTask({ state: 'queued' }));
    const claims = await Promise.all([first.claimNext(2), second.claimNext(2)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await db.close();
  });
});
