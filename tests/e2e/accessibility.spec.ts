import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/extension';
import {
  completeOnboarding,
  createRootFolder,
  putDatabaseRecord
} from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('keeps the primary extension surfaces accessible and keyboard ordered', async ({
  context,
  extensionId
}) => {
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await expect(popup.getByText('Siftmark').first()).toBeVisible();
  await expectNoSeriousViolations(popup, 'popup');

  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await expect(manager.getByRole('tab', { name: '书签' })).toBeVisible();
  await expectNoSeriousViolations(manager, 'manager');
  await manager.locator('body').click({ position: { x: 2, y: 2 } });
  await manager.keyboard.press('Tab');
  await expect(manager.getByRole('tab', { name: '书签' })).toBeFocused();
  await manager.keyboard.press('Tab');
  await expect(manager.getByRole('tab', { name: '审核' })).toBeFocused();

  const onboarding = await openExtensionPage(
    context,
    extensionId,
    'options.html'
  );
  await expect(
    onboarding.getByRole('heading', { name: '权限与隐私' })
  ).toBeVisible();
  await expectNoSeriousViolations(onboarding, 'onboarding');
  await onboarding.locator('body').click({ position: { x: 2, y: 2 } });
  await onboarding.keyboard.press('Tab');
  await expect(
    onboarding.getByRole('button', { name: '授权任务通知' })
  ).toBeFocused();
  await onboarding.keyboard.press('Tab');
  await expect(
    onboarding.getByRole('button', { name: '跳过此步' })
  ).toBeFocused();

  await completeOnboarding(onboarding);
  await expect(onboarding.getByRole('heading', { name: '设置' })).toBeVisible();
  await expectNoSeriousViolations(onboarding, 'options');
});

test('keeps review, import preview, and reset confirmation accessible', async ({
  context,
  extensionId
}) => {
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(manager, '无障碍审核');
  const bookmark = await manager.evaluate(
    async (parentId) =>
      chrome.bookmarks.create({
        parentId,
        title: '原始审核标题',
        url: 'https://a11y.siftmark.test/'
      }),
    folderId
  );
  await putDatabaseRecord(manager, 'analysisProposals', {
    id: 'a11y-proposal',
    bookmarkId: bookmark.id,
    sourceSnapshot: bookmark,
    result: {
      folderPath: ['无障碍审核'],
      title: '可访问的建议标题',
      tags: ['无障碍'],
      summary: '用于验证审核工作区语义。',
      confidence: 'low',
      reason: '需要用户确认'
    },
    state: 'pending',
    category: 'analysis',
    createdAt: Date.now()
  });
  await manager.reload();
  await manager.getByRole('tab', { name: '审核' }).click();
  await expect(
    manager.getByRole('heading', { name: '可访问的建议标题' })
  ).toBeVisible();
  await expectNoSeriousViolations(manager, 'review workspace');

  const options = await openExtensionPage(context, extensionId, 'options.html');
  await completeOnboarding(options);
  const fileInput = options.locator('input[type="file"]');
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
  await expectNoSeriousViolations(options, 'import preview');

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
