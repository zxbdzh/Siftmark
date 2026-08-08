import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures/extension';
import { completeOnboarding, createRootFolder } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('exports, previews, and safely reimports native and MarkAI backups', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  const options = await openExtensionPage(context, extensionId, 'options.html');
  await completeOnboarding(options);
  const folderId = await createRootFolder(options, '备份往返');
  const bookmarkId = await options.evaluate(async (parentId) => {
    return (
      await chrome.bookmarks.create({
        parentId,
        title: '往返书签',
        url: 'https://roundtrip.siftmark.test/'
      })
    ).id;
  }, folderId);
  await options.reload();
  const downloadPromise = options.waitForEvent('download');
  await options.getByRole('button', { name: '导出 JSON' }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  const fileInput = options.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'siftmark-roundtrip.json',
    mimeType: 'application/json',
    buffer: await readFile(backupPath!)
  });
  await options.getByRole('button', { name: '本地解析' }).click();
  await expect(options.getByText('Siftmark · 版本 1')).toBeVisible();
  await expect(options.getByText('文件已解析，尚未写入书签')).toBeVisible();
  const conflictDecisions = options.locator('.conflict-list select');
  await expect(conflictDecisions.first()).toHaveValue('keep-existing');
  expect(
    await conflictDecisions.evaluateAll((items) => items.length)
  ).toBeGreaterThan(0);
  expect(
    await conflictDecisions.evaluateAll((items) =>
      items.every(
        (item) => (item as HTMLSelectElement).value === 'keep-existing'
      )
    )
  ).toBe(true);

  const zipDownloadPromise = options.waitForEvent('download');
  await options.getByRole('button', { name: '导出 ZIP' }).click();
  const zipDownload = await zipDownloadPromise;
  const zipPath = await zipDownload.path();
  expect(zipPath).toBeTruthy();
  const zipBytes = await readFile(zipPath!);
  expect(zipBytes.subarray(0, 2).toString('ascii')).toBe('PK');

  await options.evaluate(async () => {
    await chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [
        {
          id: 'backup-profile',
          version: 'v1',
          name: '备份模型',
          protocol: 'openai-chat',
          endpoint: 'http://127.0.0.1:4173/v1',
          model: 'fixture-model',
          apiKey: 'backup-secret-key',
          timeoutMs: 10_000,
          capabilities: ['classify'],
          state: 'verified',
          verifiedAt: Date.now()
        }
      ]
    });
  });
  await options.getByLabel('密码', { exact: true }).fill('correct-password');
  await options.getByLabel('确认密码').fill('correct-password');
  const encryptedDownloadPromise = options.waitForEvent('download');
  await options.getByRole('button', { name: '导出加密归档' }).click();
  const encryptedDownload = await encryptedDownloadPromise;
  const encryptedPath = await encryptedDownload.path();
  expect(encryptedPath).toBeTruthy();
  const encryptedBytes = await readFile(encryptedPath!);
  expect(encryptedBytes.subarray(0, 8).toString('ascii')).toBe('SIFTMARK');

  await fileInput.setInputFiles({
    name: 'siftmark-complete.siftmark-backup',
    mimeType: 'application/x-siftmark-backup',
    buffer: encryptedBytes
  });
  await options.getByLabel('加密归档密码').fill('wrong-password');
  await options.getByRole('button', { name: '本地解析' }).click();
  await expect(options.locator('#backup-center output')).toHaveText(
    'encrypted-backup-authentication-failed'
  );

  await options.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
  await fileInput.setInputFiles({
    name: 'siftmark-roundtrip.zip',
    mimeType: 'application/zip',
    buffer: zipBytes
  });
  await options.getByLabel('加密归档密码').fill('');
  await options.getByRole('button', { name: '本地解析' }).click();
  await expect(options.getByText('Siftmark · 版本 1')).toBeVisible();
  await expect(options.getByText('完整性').locator('..')).toContainText(
    '已校验'
  );
  await options.getByRole('button', { name: '确认导入方案' }).click();
  await expect(options.locator('#backup-center output')).toContainText(
    '已导入'
  );
  await expect
    .poll(() =>
      options.evaluate(
        async () =>
          (
            await chrome.bookmarks.search({
              url: 'https://roundtrip.siftmark.test/'
            })
          ).length
      )
    )
    .toBe(1);

  const beforeMarkAiPreview = await options.evaluate(() =>
    chrome.bookmarks.getTree()
  );
  await fileInput.setInputFiles(
    path.join(
      process.cwd(),
      'tests',
      'fixtures',
      'backup',
      'markai-backup.json'
    )
  );
  await options.getByRole('button', { name: '本地解析' }).click();
  await expect(options.getByText('MarkAI · 版本 1')).toBeVisible();
  await expect(options.getByText(/忽略的未知字段/)).toBeVisible();
  expect(await options.evaluate(() => chrome.bookmarks.getTree())).toEqual(
    beforeMarkAiPreview
  );
});
