import { expect, test } from './fixtures/extension';
import { createRootFolder, readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

const fixtureOrigin = 'http://siftmark.test:4173';

test('saves before AI responds, captures a thumbnail, reviews selected fields, and supports undo', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(manager, '端到端收件箱');
  const undoUrl = `${fixtureOrigin}/article?flow=undo`;
  const undoArticle = await context.newPage();
  await undoArticle.goto(undoUrl);
  const undoTabId = await findTabId(manager, undoUrl);
  await mockActiveTab(context, undoTabId, undoUrl);
  const undoPopup = await openExtensionPage(context, extensionId, 'popup.html');
  await undoPopup.getByLabel('保存到').selectOption(folderId);
  await undoPopup.getByRole('button', { name: '保存书签' }).click();
  await expect(undoPopup.getByRole('status')).toContainText('已保存');
  await expect.poll(() => findBookmarkId(manager, undoUrl)).not.toBe('');
  await undoPopup.getByRole('button', { name: '撤销最近保存' }).click();
  await expect.poll(() => findBookmarkId(manager, undoUrl)).toBe('');

  await resetProvider();
  await setProviderBehavior({ delayAnalysisMs: 4_000 });
  await configureClassifier(manager);

  const reviewUrl = `${fixtureOrigin}/article?flow=review`;
  const article = await context.newPage();
  await article.goto(reviewUrl);
  const articleTabId = await findTabId(manager, reviewUrl);
  await mockActiveTab(context, articleTabId, reviewUrl);
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await expect(
    popup.getByRole('heading', { name: 'Siftmark 本地文章' })
  ).toBeVisible();
  await popup.getByLabel('保存到').selectOption(folderId);
  await manager.evaluate(
    (tabId) => chrome.tabs.update(tabId, { active: true }),
    articleTabId
  );
  await popup.getByRole('button', { name: '保存书签' }).click();
  await expect(popup.getByRole('status')).toContainText('已保存，正在后台分析');
  const reviewBookmarkId = await expect
    .poll(() => findBookmarkId(manager, reviewUrl))
    .not.toBe('')
    .then(() => findBookmarkId(manager, reviewUrl));
  await expect.poll(providerAnalysisRequestCount).toBe(1);
  expect(
    (
      await readDatabaseStore<{ bookmarkId: string }>(
        manager,
        'analysisProposals'
      )
    ).some((proposal) => proposal.bookmarkId === reviewBookmarkId)
  ).toBe(false);

  await expect
    .poll(async () => {
      const rows = await readDatabaseStore<{
        bookmarkId: string;
        state: string;
        result: { title: string; tags: string[]; summary: string };
      }>(manager, 'analysisProposals');
      return rows.find((proposal) => proposal.bookmarkId === reviewBookmarkId);
    })
    .toMatchObject({
      state: 'pending',
      result: {
        title: '本地模型建议标题',
        tags: ['端到端'],
        summary: '本地夹具摘要'
      }
    });
  await expect
    .poll(async () => {
      const thumbnails = await readDatabaseStore<{
        bookmarkId: string;
        state: string;
        width?: number;
        height?: number;
      }>(manager, 'thumbnails');
      return thumbnails.find(
        (thumbnail) => thumbnail.bookmarkId === reviewBookmarkId
      );
    })
    .toMatchObject({ state: 'ready' });

  await manager.reload();
  await manager.getByRole('tab', { name: '审核' }).click();
  await expect(
    manager.getByRole('heading', { name: '本地模型建议标题' })
  ).toBeVisible();
  await manager.getByLabel('folder').uncheck();
  await manager.getByLabel('tags').uncheck();
  await manager.getByLabel('summary').uncheck();
  await manager.getByRole('button', { name: '应用所选字段' }).click();
  await expect
    .poll(() =>
      manager.evaluate(
        async (id) => (await chrome.bookmarks.get(id))[0]?.title,
        reviewBookmarkId
      )
    )
    .toBe('本地模型建议标题');
  const metadata = await readDatabaseStore<{ bookmarkId: string }>(
    manager,
    'bookmarkMetadata'
  );
  expect(metadata.some((row) => row.bookmarkId === reviewBookmarkId)).toBe(
    false
  );
});

async function findTabId(
  page: import('@playwright/test').Page,
  url: string
): Promise<number> {
  return page.evaluate(
    (targetUrl) =>
      new Promise<number>((resolve) =>
        chrome.tabs.query({ url: targetUrl }, (tabs) => resolve(tabs[0]!.id!))
      ),
    url
  );
}

async function findBookmarkId(
  page: import('@playwright/test').Page,
  url: string
): Promise<string> {
  return page.evaluate(
    async (targetUrl) =>
      (await chrome.bookmarks.search({ url: targetUrl }))[0]?.id ?? '',
    url
  );
}

async function mockActiveTab(
  context: import('@playwright/test').BrowserContext,
  tabId: number,
  url: string
): Promise<void> {
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
              { id, url: targetUrl, title: 'Siftmark 本地文章' }
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

async function configureClassifier(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [
        {
          id: 'e2e-classifier',
          version: 'v1',
          name: '端到端分类模型',
          protocol: 'openai-chat',
          endpoint: 'http://127.0.0.1:4173/v1',
          model: 'fixture-model',
          apiKey: 'e2e-secret-key',
          timeoutMs: 10_000,
          capabilities: ['classify', 'rename', 'summarize'],
          state: 'verified',
          verifiedAt: Date.now()
        }
      ],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'e2e-classifier@v1'
      }
    });
  });
}

async function resetProvider(): Promise<void> {
  const response = await fetch('http://127.0.0.1:4173/__e2e/reset', {
    method: 'POST'
  });
  expect(response.ok).toBe(true);
}

async function setProviderBehavior(behavior: {
  delayAnalysisMs: number;
}): Promise<void> {
  const response = await fetch('http://127.0.0.1:4173/__e2e/behavior', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(behavior)
  });
  expect(response.ok).toBe(true);
}

async function providerAnalysisRequestCount(): Promise<number> {
  const response = await fetch('http://127.0.0.1:4173/__e2e/requests');
  expect(response.ok).toBe(true);
  const requests = (await response.json()) as Array<{ body: unknown }>;
  return requests.filter(
    (request) => !JSON.stringify(request.body).includes('siftmark_probe')
  ).length;
}
