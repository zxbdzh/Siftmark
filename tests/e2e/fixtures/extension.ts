import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const extensionPath = path.join(process.cwd(), '.output', 'chrome-mv3');

export const test = base.extend<{ extensionId: string }>({
  context: async ({ browserName }, provide) => {
    if (browserName !== 'chromium') {
      throw new Error('The Siftmark extension fixture requires Chromium');
    }
    const profilePath = await mkdtemp(
      path.join(tmpdir(), 'siftmark-playwright-')
    );
    const context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-proxy-server',
        '--host-resolver-rules=MAP siftmark.test 127.0.0.1'
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

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

interface ServiceWorkerVersion {
  versionId: string;
  scriptURL: string;
}

export async function restartExtensionWorker(
  context: BrowserContext,
  page: Page,
  extensionId: string
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  const workerVersion = new Promise<ServiceWorkerVersion>((resolve) => {
    const handleVersionUpdate = (event: {
      versions: ServiceWorkerVersion[];
    }) => {
      const version = event.versions.find((candidate) =>
        candidate.scriptURL.startsWith(`chrome-extension://${extensionId}/`)
      );
      if (!version) return;
      cdp.off('ServiceWorker.workerVersionUpdated', handleVersionUpdate);
      resolve(version);
    };
    cdp.on('ServiceWorker.workerVersionUpdated', handleVersionUpdate);
  });
  await cdp.send('ServiceWorker.enable');
  const getWorkerTargets = async () => {
    const targets = (await cdp.send('Target.getTargets')) as {
      targetInfos: TargetInfo[];
    };
    return targets.targetInfos.filter(
      (target) =>
        target.type === 'service_worker' &&
        target.url.startsWith(`chrome-extension://${extensionId}/`)
    );
  };
  const [workerTarget] = await getWorkerTargets();
  expect(workerTarget, 'extension Service Worker target').toBeDefined();

  const version = await workerVersion;
  await cdp.send('ServiceWorker.stopWorker', {
    versionId: version.versionId
  });
  await expect
    .poll(async () =>
      (await getWorkerTargets()).some(
        (target) => target.targetId === workerTarget!.targetId
      )
    )
    .toBe(false);

  await cdp.send('ServiceWorker.startWorker', {
    scopeURL: `chrome-extension://${extensionId}/`
  });
  await cdp.detach();
}

async function getExtensionWorker(context: BrowserContext) {
  return (
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  );
}
