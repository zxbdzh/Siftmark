import { expect, test } from './fixtures/extension';
import { createRootFolder } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

const viewports = [
  { width: 1440, height: 900, mode: 'wide' },
  { width: 1280, height: 720, mode: 'wide' },
  { width: 1024, height: 768, mode: 'wide' },
  { width: 800, height: 700, mode: 'collapsed' }
] as const;

test('uses three columns at wide widths and a detail drawer at 800px', async ({
  context,
  extensionId
}) => {
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(manager, '响应式样本');
  await manager.evaluate(
    (parentId) =>
      chrome.bookmarks.create({
        parentId,
        title: '响应式书签',
        url: 'https://responsive.siftmark.test/'
      }),
    folderId
  );
  await manager.reload();
  await manager.getByRole('treeitem', { name: '响应式样本' }).click();
  await expect(manager.getByText('响应式书签')).toBeVisible();

  for (const viewport of viewports) {
    await manager.setViewportSize(viewport);
    const folders = manager.locator('.manager-folders');
    const list = manager.locator('.manager-list');
    const detail = manager.locator('.manager-detail');
    const detailButton = manager.getByRole('button', { name: '打开详情' });

    await expect(list).toBeVisible();
    await expect(folders).toBeVisible();
    if (viewport.mode === 'wide') {
      await expect(detail).toBeVisible();
      await expect(detailButton).toBeHidden();
      const columns = await manager
        .locator('.manager-shell')
        .evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ')
        );
      expect(columns).toHaveLength(3);
    } else {
      await expect(detail).toBeHidden();
      await expect(detailButton).toBeVisible();
      await detailButton.click();
      await expect(
        manager.getByRole('dialog', { name: '书签详情' })
      ).toBeVisible();
      await manager.getByRole('button', { name: '关闭' }).click();
      await expect(
        manager.getByRole('dialog', { name: '书签详情' })
      ).toBeHidden();
    }
  }
});
