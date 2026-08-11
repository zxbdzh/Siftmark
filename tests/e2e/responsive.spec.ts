import { expect, test } from './fixtures/extension';
import { createRootFolder } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

const viewports = [
  { width: 1440, height: 900, mode: 'split' },
  { width: 800, height: 700, mode: 'split' },
  { width: 760, height: 700, mode: 'stacked' },
  { width: 390, height: 844, mode: 'stacked' }
] as const;

test('keeps the bookmark tree and batch tools usable across widths', async ({
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
  await manager.getByPlaceholder('搜索书签…').fill('响应式书签');
  await expect(manager.getByText('响应式书签', { exact: true })).toBeVisible();

  for (const viewport of viewports) {
    await manager.setViewportSize(viewport);
    const workspace = manager.locator('.manager-workspace');
    const columns = await workspace.evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(' ')
    );
    expect(columns).toHaveLength(viewport.mode === 'split' ? 2 : 1);
    await expect(manager.locator('.tree-panel')).toBeVisible();
    await expect(manager.locator('.bulk-toolbar')).toBeVisible();
    await expect(
      manager.getByText('响应式书签', { exact: true })
    ).toBeVisible();
    expect(
      await manager.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
  }
});
