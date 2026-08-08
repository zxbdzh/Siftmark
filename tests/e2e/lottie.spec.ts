import { expect, test } from './fixtures/extension';
import { createRootFolder } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('renders nonblank animated pixels while an AI task is running', async ({
  context,
  extensionId
}) => {
  const popup = await startDelayedAnalysis(context, extensionId, 'animated');
  const mark = popup.getByRole('img', { name: '正在分析' });
  await expect(mark).toHaveAttribute('data-motion', 'animated');
  await expect(mark.locator('svg')).toBeVisible();

  const paintedShape = mark.locator('svg path[fill]:not([fill="none"])');
  await expect(paintedShape).toBeVisible();

  const firstFrame = await mark.screenshot();
  await popup.waitForTimeout(300);
  const secondFrame = await mark.screenshot();
  expect(firstFrame.byteLength).toBeGreaterThan(100);
  expect(secondFrame.equals(firstFrame)).toBe(false);
});

test('keeps a nonblank static fallback stable with reduced motion', async ({
  context,
  extensionId
}) => {
  const popup = await startDelayedAnalysis(
    context,
    extensionId,
    'reduced',
    true
  );
  const mark = popup.getByRole('img', { name: '正在分析' });
  await expect(mark).toHaveAttribute('data-motion', 'static');
  await expect(mark.locator('svg')).toBeVisible();
  await expect(
    mark.locator('svg path[fill]:not([fill="none"])').first()
  ).toBeVisible();

  const firstFrame = await mark.screenshot();
  await popup.waitForTimeout(300);
  const secondFrame = await mark.screenshot();
  expect(firstFrame.byteLength).toBeGreaterThan(100);
  expect(secondFrame.equals(firstFrame)).toBe(true);
});

async function startDelayedAnalysis(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  flow: string,
  reducedMotion = false
) {
  await fetch('http://127.0.0.1:4173/__e2e/reset', { method: 'POST' });
  await fetch('http://127.0.0.1:4173/__e2e/behavior', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delayAnalysisMs: 4_000 })
  });
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(manager, `动画夹具-${flow}`);
  await configureClassifier(manager);
  const url = `http://siftmark.test:4173/article?lottie=${flow}`;
  const article = await context.newPage();
  await article.goto(url);
  const tabId = await manager.evaluate(
    (targetUrl) =>
      new Promise<number>((resolve) =>
        chrome.tabs.query({ url: targetUrl }, (tabs) => resolve(tabs[0]!.id!))
      ),
    url
  );
  await mockActiveTab(context, tabId, url);
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  if (reducedMotion) await popup.emulateMedia({ reducedMotion: 'reduce' });
  await popup.getByLabel('保存到').selectOption(folderId);
  await popup.getByRole('button', { name: '保存书签' }).click();
  await expect(popup.getByRole('status')).toContainText('已保存，正在后台分析');
  return popup;
}

async function configureClassifier(page: import('@playwright/test').Page) {
  await page.evaluate(() =>
    chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [
        {
          id: 'lottie-classifier',
          version: 'v1',
          name: 'Lottie 验收模型',
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
        classify: 'lottie-classifier@v1'
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
              { id, url: targetUrl, title: 'Lottie 验收文章' }
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
