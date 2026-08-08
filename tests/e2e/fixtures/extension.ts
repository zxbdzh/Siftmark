import {
  chromium,
  expect,
  test as base,
  type BrowserContext
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const extensionPath = path.join(process.cwd(), '.output', 'chrome-mv3');

export const test = base.extend<{ extensionId: string }>({
  context: async ({ browserName: _browserName }, provide) => {
    const profilePath = await mkdtemp(
      path.join(tmpdir(), 'siftmark-playwright-')
    );
    const context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
    try {
      await provide(context);
    } finally {
      await context.close();
      await rm(profilePath, { recursive: true, force: true });
    }
  },
  extensionId: async ({ context }, provide) => {
    const worker = await getExtensionWorker(context);
    await provide(new URL(worker.url()).host);
  }
});

export { expect };

async function getExtensionWorker(context: BrowserContext) {
  return (
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  );
}
