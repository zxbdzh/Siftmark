import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

export const COMPLETED_ONBOARDING_STATE = {
  version: 1,
  status: 'completed',
  currentStep: null,
  completedSteps: [
    'permissions-privacy',
    'special-folders',
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

export async function createRootFolder(
  page: Page,
  title: string
): Promise<string> {
  return page.evaluate(async (folderTitle) => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0]?.children?.find((node) => !node.url) ?? tree[0];
    if (!root) throw new Error('Missing native bookmark root');
    return (
      await chrome.bookmarks.create({ parentId: root.id, title: folderTitle })
    ).id;
  }, title);
}

export async function putDatabaseRecord(
  page: Page,
  storeName: string,
  value: unknown
): Promise<void> {
  await page.evaluate(
    async ({ name, record }) => {
      const request = indexedDB.open('siftmark');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(name, 'readwrite');
      transaction.objectStore(name).put(record);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { name: storeName, record: value }
  );
}

export async function readDatabaseStore<T>(
  page: Page,
  storeName: string
): Promise<T[]> {
  return page.evaluate(async (name) => {
    const request = indexedDB.open('siftmark');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(name, 'readonly');
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const getAll = transaction.objectStore(name).getAll();
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
    database.close();
    return rows;
  }, storeName) as Promise<T[]>;
}
