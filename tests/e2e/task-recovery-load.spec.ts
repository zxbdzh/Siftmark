import { expect, restartExtensionWorker, test } from './fixtures/extension';
import { readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

const TASK_COUNT = 1_000;
const terminalStates = [
  'succeeded',
  'failed',
  'paused',
  'unknown',
  'cancelled'
] as const;

test('recovers 1,000 claimed local tasks without duplicate keys or lost terminal states', async ({
  context,
  extensionId
}, testInfo) => {
  test.setTimeout(60_000);
  const page = await openExtensionPage(context, extensionId, 'manager.html');
  await expect(page.locator('.manager-page')).toBeVisible();

  const queuedAt = Date.now();
  const taskIds = await page.evaluate(async (count) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 100) {
      const replies = (await Promise.all(
        Array.from({ length: Math.min(100, count - index) }, () =>
          chrome.runtime.sendMessage({ type: 'queue-recycle-purge' })
        )
      )) as Array<{ taskId: string }>;
      ids.push(...replies.map((reply) => reply.taskId));
    }
    return ids;
  }, TASK_COUNT);
  expect(taskIds).toHaveLength(TASK_COUNT);
  const before = (
    await readDatabaseStore<{
      id: string;
      idempotencyKey: string;
    }>(page, 'tasks')
  ).filter((task) => taskIds.includes(task.id));
  expect(before).toHaveLength(TASK_COUNT);
  expect(new Set(before.map((task) => task.idempotencyKey)).size).toBe(
    TASK_COUNT
  );

  await markTasksClaimed(page, taskIds);
  await restartExtensionWorker(context, page, extensionId);
  await expect
    .poll(
      async () => {
        const rows = await readDatabaseStore<{ id: string; state: string }>(
          page,
          'tasks'
        );
        return rows.filter(
          (task) => taskIds.includes(task.id) && task.state === 'paused'
        ).length;
      },
      { timeout: 30_000 }
    )
    .toBe(TASK_COUNT);

  const after = (
    await readDatabaseStore<{
      id: string;
      state: string;
      idempotencyKey: string;
    }>(page, 'tasks')
  ).filter((task) => taskIds.includes(task.id));
  expect(after).toHaveLength(TASK_COUNT);
  expect(after.every((task) => task.state === 'paused')).toBe(true);
  expect(new Set(after.map((task) => task.id)).size).toBe(TASK_COUNT);
  expect(new Set(after.map((task) => task.idempotencyKey)).size).toBe(
    TASK_COUNT
  );
  expect(after.map((task) => task.idempotencyKey).sort()).toEqual(
    before.map((task) => task.idempotencyKey).sort()
  );
  await testInfo.attach('task-recovery-observation.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          tasks: TASK_COUNT,
          elapsedMs: Date.now() - queuedAt,
          terminalCounts: Object.fromEntries(
            terminalStates.map((state) => [
              state,
              after.filter((task) => task.state === state).length
            ])
          )
        },
        null,
        2
      )
    ),
    contentType: 'application/json'
  });
});

async function markTasksClaimed(
  page: import('@playwright/test').Page,
  taskIds: string[]
) {
  await page.evaluate(async (ids) => {
    const request = indexedDB.open('siftmark');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('tasks', 'readwrite');
    const store = transaction.objectStore('tasks');
    for (const id of ids) {
      const get = store.get(id);
      get.onsuccess = () => {
        if (get.result) {
          store.put({
            ...get.result,
            state: 'running',
            updatedAt: Date.now()
          });
        }
      };
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, taskIds);
}
