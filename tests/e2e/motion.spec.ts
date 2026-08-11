import { expect, test } from './fixtures/extension';
import { createRootFolder } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('keeps shell motion fast, contextual, and reduced-motion safe', async ({
  context,
  extensionId
}) => {
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  const popupMotion = await popup
    .locator('.popup-shell')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationName: style.animationName,
        transitionDuration: style.transitionDuration
      };
    });
  expect(popupMotion).toEqual({
    animationName: 'none',
    transitionDuration: '0s'
  });

  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await createRootFolder(manager, '动效验证目录');
  await manager.reload();

  const folderRow = manager
    .locator('.bookmark-tree-row')
    .filter({ hasText: '动效验证目录' });
  await expect(folderRow).toBeVisible();
  const disclosure = folderRow.locator('.tree-disclosure');
  const disclosureIcon = disclosure.locator('svg');
  await expect(disclosureIcon).toHaveCSS('transition-duration', '0.16s');
  const wasOpen = await disclosureIcon.getAttribute('data-open');
  await disclosure.click();
  expect(await disclosureIcon.getAttribute('data-open')).not.toBe(wasOpen);

  await folderRow.click({ button: 'right' });
  const menu = manager.locator('.tree-context-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('transition-duration', '0.16s, 0.16s');
  await manager.locator('.manager-topbar').click({ position: { x: 2, y: 2 } });
  await expect(menu).toHaveAttribute('data-closing', 'true');
  await expect(menu).toHaveCSS('transition-duration', '0.12s');
  await expect(menu).toHaveCount(0, { timeout: 500 });

  await manager.emulateMedia({ reducedMotion: 'reduce' });
  await folderRow.click({ button: 'right' });
  const reducedMenu = manager.locator('.tree-context-menu');
  await expect(reducedMenu).toBeVisible();
  await expect(reducedMenu).toHaveCSS('transform', 'none');
  await expect(reducedMenu).toHaveCSS('transition-property', 'opacity');
});
