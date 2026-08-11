import type { CaptureSession } from '../../src/capture-agent';
import { expect, test } from './fixtures/extension';
import { createRootFolder, readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

const fixtureOrigin = 'http://siftmark.test:43173';

test('saves first, requests approval for risk, applies locally, and supports undo', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const destinationId = await createRootFolder(manager, '测试');
  const inboxId = await createRootFolder(manager, '端到端收件箱');
  await configureCaptureAgent(manager, inboxId);
  await resetProvider();
  await setProviderBehavior({ delayAnalysisMs: 2_000 });

  const url = `${fixtureOrigin}/article?flow=capture-agent`;
  const article = await context.newPage();
  await article.goto(url);
  await article.bringToFront();
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));

  const savedAt = Date.now();
  const bookmark = await worker.evaluate(
    async ({ parentId, targetUrl }) =>
      chrome.bookmarks.create({
        parentId,
        index: 0,
        title: 'Siftmark 本地文章',
        url: targetUrl
      }),
    { parentId: destinationId, targetUrl: url }
  );
  expect(Date.now() - savedAt).toBeLessThan(2_000);
  await expect.poll(() => findBookmarkId(manager, url)).toBe(bookmark.id);

  const processing = article.getByRole('status');
  await expect(processing).toContainText('分析过程');
  await expect(processing).toContainText('原生书签已保存');
  await expect(processing).toContainText('AI 正在生成归类方案');

  await expect
    .poll(async () => (await findCaptureSession(manager, bookmark.id))?.state)
    .toBe('pending');
  const pending = await findCaptureSession(manager, bookmark.id);
  expect(pending).toMatchObject({
    state: 'pending',
    plan: {
      title: '本地模型建议标题',
      destination: { folderId: destinationId }
    },
    risk: {
      decision: 'approval',
      canExecute: true
    }
  });
  expect(pending?.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'capture', status: 'completed' }),
      expect.objectContaining({ kind: 'folders', status: 'completed' }),
      expect.objectContaining({ kind: 'model', status: 'completed' }),
      expect.objectContaining({ kind: 'risk', status: 'completed' })
    ])
  );
  await expect.poll(() => bookmarkParent(manager, bookmark.id)).toBe(inboxId);

  const agent = await openExtensionPage(
    context,
    extensionId,
    `sidepanel.html?session=${pending!.id}`
  );
  await expect(agent.getByText('分析过程')).toBeVisible();
  await expect(agent.getByText('已比较候选目录')).toBeVisible();
  await expect(agent.getByText('风险检查完成')).toBeVisible();

  const approval = article.getByRole('dialog');
  await expect(approval).toContainText('批准这次整理吗？');
  await expect(approval).toContainText('测试');
  await expect(approval).toContainText('本地模型建议标题');
  await approval.getByRole('button', { name: '允许' }).click();

  await expect
    .poll(() => bookmarkState(manager, bookmark.id))
    .toMatchObject({
      parentId: destinationId,
      title: '本地模型建议标题'
    });
  await expect(article.getByRole('status')).toContainText('收藏已放好');

  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await expect(popup.getByRole('heading', { name: '最近结果' })).toBeVisible();
  await expect(popup.getByText('本地模型建议标题')).toBeVisible();
  await popup.getByRole('button', { name: '撤销 本地模型建议标题' }).click();

  await expect
    .poll(() => bookmarkState(manager, bookmark.id))
    .toMatchObject({ parentId: inboxId, title: 'Siftmark 本地文章' });
  await expect(popup.getByText('已撤销')).toBeVisible();
});

async function configureCaptureAgent(
  page: import('@playwright/test').Page,
  inboxId: string
): Promise<void> {
  await page.evaluate(async (configuredInboxId) => {
    await chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [
        {
          id: 'e2e-classifier',
          version: 'v1',
          name: '端到端收藏模型',
          protocol: 'openai-chat',
          endpoint: 'http://127.0.0.1:43173/v1',
          model: 'fixture-model',
          apiKey: 'e2e-secret-key',
          timeoutMs: 10_000,
          capabilities: ['classify', 'rename', 'summarize'],
          state: 'verified',
          verifiedAt: Date.now()
        }
      ],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'e2e-classifier@v1',
        agent: 'e2e-classifier@v1'
      },
      'siftmark.settings.special-folders.v1': {
        inboxId: configuredInboxId
      }
    });
  }, inboxId);
}

async function findCaptureSession(
  page: import('@playwright/test').Page,
  bookmarkId: string
): Promise<CaptureSession | undefined> {
  const records = await readDatabaseStore<{ payload: CaptureSession }>(
    page,
    'captureSessions'
  );
  return records
    .map((record) => record.payload)
    .find((session) => session.bookmarkId === bookmarkId);
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

async function bookmarkParent(
  page: import('@playwright/test').Page,
  bookmarkId: string
): Promise<string | undefined> {
  return page.evaluate(
    async (id) => (await chrome.bookmarks.get(id))[0]?.parentId,
    bookmarkId
  );
}

async function bookmarkState(
  page: import('@playwright/test').Page,
  bookmarkId: string
): Promise<{ parentId?: string; title?: string }> {
  return page.evaluate(async (id) => {
    const bookmark = (await chrome.bookmarks.get(id))[0];
    return { parentId: bookmark?.parentId, title: bookmark?.title };
  }, bookmarkId);
}

async function resetProvider(): Promise<void> {
  const response = await fetch('http://127.0.0.1:43173/__e2e/reset', {
    method: 'POST'
  });
  expect(response.ok).toBe(true);
}

async function setProviderBehavior(behavior: {
  delayAnalysisMs: number;
}): Promise<void> {
  const response = await fetch('http://127.0.0.1:43173/__e2e/behavior', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(behavior)
  });
  expect(response.ok).toBe(true);
}
