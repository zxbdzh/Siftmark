import { expect, test } from './fixtures/extension';
import { readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';
import {
  LARGE_LIBRARY_BOOKMARKS,
  LARGE_LIBRARY_FOLDERS,
  seedLargeBookmarkLibrary
} from '../performance/bookmark-fixture';

test('keeps a 10,000-bookmark library virtualized, searchable, and responsive', async ({
  context,
  extensionId
}, testInfo) => {
  test.setTimeout(120_000);
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await expect(manager.locator('.manager-shell')).toBeVisible();
  const seededAt = Date.now();
  const fixture = await seedLargeBookmarkLibrary(manager);
  const seedMs = Date.now() - seededAt;
  expect(fixture.folderIds).toHaveLength(LARGE_LIBRARY_FOLDERS);
  expect(fixture.bookmarkIds).toHaveLength(LARGE_LIBRARY_BOOKMARKS);

  const loadedAt = Date.now();
  await manager.reload();
  await expect(manager.locator('.bookmark-row').first()).toBeVisible({
    timeout: 20_000
  });
  const managerLoadMs = Date.now() - loadedAt;
  expect(managerLoadMs).toBeLessThan(20_000);
  await expect
    .poll(() => manager.locator('.bookmark-row').count())
    .toBeLessThan(50);

  const bookmarkRegionBefore = await manager
    .locator('.bookmark-list-region')
    .boundingBox();
  await manager.locator('.bookmark-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(manager.getByText(fixture.targetTitle)).toBeVisible();
  await manager.getByText(fixture.targetTitle).click();
  expect(await manager.locator('.bookmark-list-region').boundingBox()).toEqual(
    bookmarkRegionBefore
  );

  const searchStartedAt = Date.now();
  await manager
    .getByPlaceholder('搜索标题、网址、标签、摘要和笔记')
    .fill('性能终点书签 9999');
  const searchResults = manager.getByRole('group', {
    name: '当前文件夹书签'
  });
  await expect(searchResults.getByText(fixture.targetTitle)).toBeVisible({
    timeout: 15_000
  });
  await expect(manager.getByText(/^本地搜索 · \d+ 项$/)).toBeVisible();
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

  const articleUrl = 'http://siftmark.test:4173/article?performance=10000';
  const article = await context.newPage();
  await article.goto(articleUrl);
  const tabId = await manager.evaluate(
    (url) =>
      new Promise<number>((resolve) =>
        chrome.tabs.query({ url }, (tabs) => resolve(tabs[0]!.id!))
      ),
    articleUrl
  );
  await mockActiveTab(context, tabId, articleUrl);
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await popup.getByLabel('保存到').selectOption(fixture.folderIds[0]!);
  const saveStartedAt = Date.now();
  await popup.getByRole('button', { name: '保存书签' }).click();
  await expect(popup.getByRole('status')).toContainText('已保存');
  const popupSaveMs = Date.now() - saveStartedAt;
  expect(popupSaveMs).toBeLessThan(2_000);

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
          popupSaveMs,
          renderedRows: await manager.locator('.bookmark-row').count(),
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
  const response = await fetch('http://127.0.0.1:4173/__e2e/reset', {
    method: 'POST'
  });
  expect(response.ok).toBe(true);
}

async function setProviderBehavior(delayAnalysisMs: number) {
  const response = await fetch('http://127.0.0.1:4173/__e2e/behavior', {
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
          endpoint: 'http://127.0.0.1:4173/v1',
          model: 'fixture-model',
          apiKey: 'fixture-secret',
          timeoutMs: 10_000,
          capabilities: ['classify'],
          state: 'verified',
          verifiedAt: Date.now()
        }
      ],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'performance-classifier@v1'
      }
    })
  );
}

async function mockActiveTab(
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  url: string
) {
  await context.addInitScript(
    ({ id, targetUrl }) => {
      if (!globalThis.chrome?.tabs) return;
      const original = chrome.tabs.query.bind(chrome.tabs);
      Object.defineProperty(chrome.tabs, 'query', {
        configurable: true,
        value: (
          queryInfo: chrome.tabs.QueryInfo,
          callback?: (tabs: chrome.tabs.Tab[]) => void
        ) => {
          if (queryInfo.active && queryInfo.currentWindow) {
            const tabs = [
              { id, url: targetUrl, title: '万级书签保存验证' }
            ] as chrome.tabs.Tab[];
            if (callback) {
              callback(tabs);
              return;
            }
            return Promise.resolve(tabs);
          }
          return original(queryInfo, callback!);
        }
      });
    },
    { id: tabId, targetUrl: url }
  );
}
