import { expect, test, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('loads the built Siftmark popup in Chromium', async () => {
  const extensionPath = path.join(process.cwd(), '.output', 'chrome-mv3');
  const profilePath = await mkdtemp(path.join(tmpdir(), 'siftmark-playwright-'));
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('.brand-type')).toHaveText('Siftmark');
    await expect(page.getByRole('button', { name: '保存书签' })).toBeVisible();
    await page.goto(`chrome-extension://${extensionId}/manager.html`);
    await expect(page.getByRole('complementary', { name: '文件夹', exact: true })).toBeVisible();
    await expect(page.getByRole('main', { name: '书签列表' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '打开文件夹' })).toBeVisible();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  } finally {
    await context?.close();
    await rm(profilePath, { recursive: true, force: true });
  }
});
