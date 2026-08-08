import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

export const COMPLETED_ONBOARDING_STATE = {
  version: 1,
  status: 'completed',
  currentStep: null,
  completedSteps: [
    'permissions-privacy',
    'special-folders',
    'floating-button',
    'model',
    'migration',
    'read-only-scan'
  ],
  skippedSteps: [],
  updatedAt: 1
} as const;

export default function buildExtension(): void {
  const executable =
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
  const args =
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm build'] : ['build'];
  execFileSync(executable, args, {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
}

export async function completeOnboarding(page: Page): Promise<void> {
  await page.evaluate(async (state) => {
    await chrome.storage.local.set({ 'siftmark.onboarding.v1': state });
  }, COMPLETED_ONBOARDING_STATE);
  await page.reload();
}

export async function clearSiftmarkState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const stored = await chrome.storage.local.get(null);
    const keys = Object.keys(stored).filter((key) =>
      key.startsWith('siftmark.')
    );
    if (keys.length > 0) await chrome.storage.local.remove(keys);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('siftmark');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
}
