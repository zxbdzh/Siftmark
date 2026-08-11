import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/extension';
import { createRootFolder, putDatabaseRecord } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('keeps the primary extension surfaces accessible and keyboard ordered', async ({
  context,
  extensionId
}) => {
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await expect(popup.getByText('Siftmark').first()).toBeVisible();
  await expectNoSeriousViolations(popup, 'popup');

  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await expect(manager.getByPlaceholder('搜索书签…')).toBeVisible();
  await expectNoSeriousViolations(manager, 'manager');
  await manager.locator('body').click({ position: { x: 2, y: 2 } });
  await manager.keyboard.press('Tab');
  await expect(manager.getByRole('button', { name: '设置' })).toBeFocused();
  await manager.keyboard.press('Tab');
  await expect(manager.getByPlaceholder('搜索书签…')).toBeFocused();

  const options = await openExtensionPage(context, extensionId, 'options.html');
  await expect(
    options.getByRole('heading', { name: '设置', exact: true })
  ).toBeVisible();
  await expectNoSeriousViolations(options, 'options');
  await options.locator('body').click({ position: { x: 2, y: 2 } });
  await options.keyboard.press('Tab');
  await expect(options.getByRole('link', { name: '设置' })).toBeFocused();

  const sidePanel = await openExtensionPage(
    context,
    extensionId,
    'sidepanel.html'
  );
  await expect(sidePanel.getByText('没有进行中的收藏')).toBeVisible();
  await expectNoSeriousViolations(sidePanel, 'empty side panel');
});

test('keeps Agent approval, import preview, and reset confirmation accessible', async ({
  context,
  extensionId
}) => {
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(manager, '无障碍审批');
  const bookmark = await manager.evaluate(
    async (parentId) =>
      chrome.bookmarks.create({
        parentId,
        title: '原始审批标题',
        url: 'https://a11y.siftmark.test/'
      }),
    folderId
  );
  const timestamp = Date.now();
  await putDatabaseRecord(manager, 'captureSessions', {
    id: 'a11y-capture-session',
    bookmarkId: bookmark.id,
    state: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + 60_000,
    payload: {
      id: 'a11y-capture-session',
      bookmarkId: bookmark.id,
      trigger: 'native-bookmark',
      sourceSnapshot: bookmark,
      state: 'pending',
      plan: {
        destination: {
          folderId,
          path: [{ id: folderId, title: '无障碍审批' }],
          newFolders: []
        },
        title: '可访问的建议标题',
        tags: ['无障碍'],
        summary: '用于验证审批界面语义。',
        confidence: 'low',
        reason: '需要用户确认',
        relatedBookmarks: [],
        generatedAt: timestamp
      },
      risk: {
        decision: 'approval',
        reasons: ['low-confidence'],
        canExecute: true
      },
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + 60_000
    }
  });
  const sidePanel = await openExtensionPage(
    context,
    extensionId,
    'sidepanel.html?session=a11y-capture-session'
  );
  await expect(sidePanel.getByText('可访问的建议标题')).toBeVisible();
  await expectNoSeriousViolations(sidePanel, 'Agent approval');

  const backup = await openExtensionPage(
    context,
    extensionId,
    'options.html#backup'
  );
  const fileInput = backup.locator('input[type="file"]');
  await fileInput.setInputFiles(
    path.join(
      process.cwd(),
      'tests',
      'fixtures',
      'backup',
      'markai-backup.json'
    )
  );
  await backup.getByRole('button', { name: '本地解析' }).click();
  await expect(backup.getByText('MarkAI · 版本 1')).toBeVisible();
  await expectNoSeriousViolations(backup, 'import preview');

  const options = await openExtensionPage(context, extensionId, 'options.html');
  const reset = options.locator('.reset-section');
  await reset.getByLabel('重置范围').selectOption('all-siftmark-data');
  await reset.getByRole('button', { name: '预览影响' }).click();
  await expect(reset.getByLabel('确认短语')).toBeVisible();
  await expectNoSeriousViolations(options, 'reset confirmation');
});

async function expectNoSeriousViolations(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = result.violations
    .filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical'
    )
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target)
    }));
  expect(violations, `${surface} axe violations`).toEqual([]);
}
