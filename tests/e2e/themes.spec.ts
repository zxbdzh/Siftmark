import path from 'node:path';
import { expect, test } from './fixtures/extension';
import { createRootFolder } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '800x700', width: 800, height: 700 }
] as const;
const appearances = [
  { theme: 'light', density: 'comfortable', rowHeight: 44 },
  { theme: 'light', density: 'compact', rowHeight: 34 },
  { theme: 'dark', density: 'comfortable', rowHeight: 44 },
  { theme: 'dark', density: 'compact', rowHeight: 34 }
] as const;

test('renders the complete viewport, theme, and density matrix', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(manager, '视觉矩阵');
  await manager.evaluate(
    (parentId) =>
      chrome.bookmarks.create({
        parentId,
        title: '主题与密度样本',
        url: 'https://theme.siftmark.test/'
      }),
    folderId
  );

  for (const appearance of appearances) {
    await manager.evaluate(
      (value) =>
        chrome.storage.local.set({
          'siftmark.settings.appearance.v1': value
        }),
      appearance
    );
    await manager.reload();
    await manager.getByRole('treeitem', { name: '视觉矩阵' }).click();
    const row = manager.getByRole('button', { name: /主题与密度样本/ });
    await expect(row).toBeVisible();
    await expect(manager.locator('html')).toHaveAttribute(
      'data-theme',
      appearance.theme
    );
    await expect(manager.locator('html')).toHaveAttribute(
      'data-density',
      appearance.density
    );
    expect((await row.boundingBox())?.height).toBe(appearance.rowHeight);

    for (const viewport of viewports) {
      await manager.setViewportSize(viewport);
      await manager.evaluate(() => document.fonts.ready);
      await manager.screenshot({
        path: path.join(
          process.cwd(),
          'tests',
          'visual',
          `gate6-manager-${viewport.name}-${appearance.theme}-${appearance.density}.png`
        ),
        animations: 'disabled'
      });
    }
  }
});
