import { expect, restartExtensionWorker, test } from './fixtures/extension';
import {
  createRootFolder,
  putDatabaseRecord,
  readDatabaseStore
} from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('classifies a 21-bookmark selection and recovers durable work', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  await resetProvider();
  await setProviderBehavior({ failAnalysisCount: 1 });
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await configureClassifier(manager);
  const folderId = await createRootFolder(manager, '批量归类目标');
  const bookmarkIds = await manager.evaluate(async (parentId) => {
    const ids: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const bookmark = await chrome.bookmarks.create({
        parentId,
        title: `批量书签 ${index + 1}`,
        url: `http://127.0.0.1:43173/article?batch=${index}`
      });
      ids.push(bookmark.id);
    }
    return ids;
  }, folderId);

  await manager.reload();
  await manager.getByPlaceholder('搜索书签…').fill('批量归类目标');
  const folderRow = manager
    .locator('.bookmark-tree-row')
    .filter({ hasText: '批量归类目标' });
  await folderRow.locator('input[type="checkbox"]').check();
  await expect(manager.locator('.selection-count')).toContainText('21');
  await manager.getByRole('button', { name: '批量归类', exact: true }).click();
  await expect(manager.locator('.bulk-toolbar output')).toContainText(
    'AI 归类完成：20 成功，1 失败'
  );

  await expect
    .poll(
      async () => {
        const metadata = await readDatabaseStore<{ bookmarkId: string }>(
          manager,
          'bookmarkMetadata'
        );
        return metadata.filter((row) => bookmarkIds.includes(row.bookmarkId))
          .length;
      },
      { timeout: 20_000 }
    )
    .toBe(20);

  const metadata = await readDatabaseStore<{ bookmarkId: string }>(
    manager,
    'bookmarkMetadata'
  );
  const completedIds = new Set(metadata.map((row) => row.bookmarkId));
  const failedBookmarkId = bookmarkIds.find((id) => !completedIds.has(id));
  expect(failedBookmarkId).toBeDefined();
  const retryResults = await manager.evaluate(
    (bookmarkId) =>
      chrome.runtime.sendMessage({
        type: 'bulk-classify',
        input: { bookmarkIds: [bookmarkId] }
      }),
    failedBookmarkId!
  );
  expect(retryResults).toEqual([
    expect.objectContaining({ success: true, bookmarkId: failedBookmarkId })
  ]);
  await expect
    .poll(
      async () => {
        const rows = await readDatabaseStore<{ bookmarkId: string }>(
          manager,
          'bookmarkMetadata'
        );
        return rows.filter((row) => bookmarkIds.includes(row.bookmarkId)).length;
      },
      { timeout: 20_000 }
    )
    .toBe(21);
  await expect
    .poll(() =>
      manager.evaluate(async () => {
        const key = 'siftmark.smart-bookmark.history.v1';
        const value = (await chrome.storage.local.get(key))[key];
        return Array.isArray(value) ? value.length : 0;
      })
    )
    .toBe(21);

  const now = Date.now();
  await putDatabaseRecord(manager, 'tasks', {
    id: 'recover-after-restart',
    type: 'analyze-bookmark',
    state: 'running',
    input: {},
    completed: 7,
    failed: 1,
    retryCount: 0,
    idempotencyKey: 'restart-once',
    createdAt: now,
    updatedAt: now
  });
  await restartExtensionWorker(context, manager, extensionId);
  await expect
    .poll(async () => {
      const rows = await readDatabaseStore<{
        id: string;
        state: string;
        idempotencyKey: string;
      }>(manager, 'tasks');
      return rows.find((row) => row.id === 'recover-after-restart')?.state;
    })
    .toBe('unknown');
  const rows = await readDatabaseStore<{ idempotencyKey: string }>(
    manager,
    'tasks'
  );
  expect(
    rows.filter((row) => row.idempotencyKey === 'restart-once')
  ).toHaveLength(1);
});

async function configureClassifier(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [
        {
          id: 'e2e-batch-classifier',
          version: 'v1',
          name: '批量分类夹具',
          protocol: 'openai-chat',
          endpoint: 'http://127.0.0.1:43173/v1',
          model: 'fixture-model',
          apiKey: 'e2e-secret-key',
          timeoutMs: 10_000,
          capabilities: ['classify'],
          state: 'verified',
          verifiedAt: Date.now()
        }
      ],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'e2e-batch-classifier@v1'
      },
      'siftmark.settings.smart-bookmark.v1': {
        allowNewFolders: true,
        folderCreationLevel: 'weak',
        smartRename: true,
        renameMaxLength: 12,
        captureNativeBookmarks: false
      }
    });
  });
}

async function resetProvider(): Promise<void> {
  const response = await fetch('http://127.0.0.1:43173/__e2e/reset', {
    method: 'POST'
  });
  expect(response.ok).toBe(true);
}

async function setProviderBehavior(behavior: {
  failAnalysisCount: number;
}): Promise<void> {
  const response = await fetch('http://127.0.0.1:43173/__e2e/behavior', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(behavior)
  });
  expect(response.ok).toBe(true);
}
