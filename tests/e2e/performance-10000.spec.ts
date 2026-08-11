import { expect, test } from './fixtures/extension';
import { readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';
import {
  LARGE_LIBRARY_BOOKMARKS,
  LARGE_LIBRARY_FOLDERS,
  seedLargeBookmarkLibrary
} from '../performance/bookmark-fixture';

test('keeps a 10,000-bookmark tree searchable and responsive', async ({
  context,
  extensionId
}, testInfo) => {
  test.setTimeout(120_000);
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await expect(manager.locator('.manager-page')).toBeVisible();
  await setNativeCapture(manager, false);
  const seededAt = Date.now();
  const fixture = await seedLargeBookmarkLibrary(manager);
  const seedMs = Date.now() - seededAt;
  expect(fixture.folderIds).toHaveLength(LARGE_LIBRARY_FOLDERS);
  expect(fixture.bookmarkIds).toHaveLength(LARGE_LIBRARY_BOOKMARKS);

  const loadedAt = Date.now();
  await manager.reload();
  await expect(manager.locator('.bookmark-tree-row').first()).toBeVisible({
    timeout: 20_000
  });
  const managerLoadMs = Date.now() - loadedAt;
  expect(managerLoadMs).toBeLessThan(20_000);
  await expect
    .poll(() => manager.locator('.bookmark-tree-row').count())
    .toBeLessThan(300);

  const searchStartedAt = Date.now();
  await manager.getByPlaceholder('搜索书签…').fill('性能终点书签 9999');
  await expect(manager.getByText(fixture.targetTitle)).toBeVisible({
    timeout: 15_000
  });
  const searchMs = Date.now() - searchStartedAt;
  expect(searchMs).toBeLessThan(15_000);

  await resetProvider();
  await setProviderBehavior(4_000);
  await configureClassifier(manager);
  const delayedTask = (await manager.evaluate(
    (bookmarkId) =>
      chrome.runtime.sendMessage({
        type: 'queue-analysis',
        input: { bookmarkId }
      }),
    fixture.bookmarkIds[0]
  )) as { taskId: string };
  await expect
    .poll(async () => {
      const rows = await readDatabaseStore<{ id: string; state: string }>(
        manager,
        'tasks'
      );
      return rows.find((row) => row.id === delayedTask.taskId)?.state;
    })
    .toBe('running');

  await setNativeCapture(manager, true);

  const articleUrl = 'http://siftmark.test:43173/article?performance=10000';
  const article = await context.newPage();
  await article.goto(articleUrl);
  await article.bringToFront();
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const saveStartedAt = Date.now();
  await worker.evaluate(
    async ({ parentId, url }) =>
      chrome.bookmarks.create({
        parentId,
        index: 0,
        title: '万级书签保存验证',
        url
      }),
    { parentId: fixture.folderIds[0]!, url: articleUrl }
  );
  const nativeSaveMs = Date.now() - saveStartedAt;
  expect(nativeSaveMs).toBeLessThan(2_000);
  await expect
    .poll(() =>
      manager.evaluate(
        async (url) => (await chrome.bookmarks.search({ url })).length,
        articleUrl
      )
    )
    .toBe(1);
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await expect(popup.getByText('万级书签保存验证')).toBeVisible();

  const cdp = await context.newCDPSession(manager);
  await cdp.send('Performance.enable');
  const metrics = (await cdp.send('Performance.getMetrics')) as {
    metrics: Array<{ name: string; value: number }>;
  };
  await cdp.detach();
  const heapBytes =
    metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ??
    0;
  expect(heapBytes).toBeLessThan(512 * 1024 * 1024);
  await testInfo.attach('performance-observation.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          browserVersion: context.browser()?.version() ?? 'unknown',
          seed: fixture.seed,
          seedMs,
          managerLoadMs,
          searchMs,
          nativeSaveMs,
          renderedRows: await manager.locator('.bookmark-tree-row').count(),
          heapBytes
        },
        null,
        2
      )
    ),
    contentType: 'application/json'
  });
});

async function resetProvider() {
  const response = await fetch('http://127.0.0.1:43173/__e2e/reset', {
    method: 'POST'
  });
  expect(response.ok).toBe(true);
}

async function setProviderBehavior(delayAnalysisMs: number) {
  const response = await fetch('http://127.0.0.1:43173/__e2e/behavior', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delayAnalysisMs })
  });
  expect(response.ok).toBe(true);
}

async function configureClassifier(page: import('@playwright/test').Page) {
  await page.evaluate(() =>
    chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [
        {
          id: 'performance-classifier',
          version: 'v1',
          name: '性能夹具模型',
          protocol: 'openai-chat',
          endpoint: 'http://127.0.0.1:43173/v1',
          model: 'fixture-model',
          apiKey: 'fixture-secret',
          timeoutMs: 10_000,
          capabilities: ['classify'],
          state: 'verified',
          verifiedAt: Date.now()
        }
      ],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'performance-classifier@v1',
        agent: 'performance-classifier@v1'
      }
    })
  );
}

async function setNativeCapture(
  page: import('@playwright/test').Page,
  captureNativeBookmarks: boolean
) {
  await page.evaluate(
    (enabled) =>
      chrome.storage.local.set({
        'siftmark.settings.smart-bookmark.v1': {
          allowNewFolders: true,
          folderCreationLevel: 'weak',
          smartRename: true,
          renameMaxLength: 12,
          captureNativeBookmarks: enabled
        }
      }),
    captureNativeBookmarks
  );
}
