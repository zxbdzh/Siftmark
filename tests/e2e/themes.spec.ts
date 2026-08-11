import { expect, test } from './fixtures/extension';
import { openExtensionPage } from './helpers/extension-pages';

const appearances = [
  { theme: 'light', density: 'comfortable' },
  { theme: 'light', density: 'compact' },
  { theme: 'dark', density: 'comfortable' },
  { theme: 'dark', density: 'compact' }
] as const;

for (const appearance of appearances) {
  test(`persists ${appearance.theme} ${appearance.density} appearance`, async ({
    context,
    extensionId
  }) => {
    const options = await openExtensionPage(
      context,
      extensionId,
      'options.html'
    );
    await options
      .getByLabel('主题')
      .selectOption(appearance.theme);
    await expect
      .poll(() => readAppearance(options))
      .toMatchObject({ theme: appearance.theme });
    await options
      .getByLabel('密度')
      .selectOption(appearance.density);
    await expect(options.locator('html')).toHaveAttribute(
      'data-theme',
      appearance.theme
    );
    await expect(options.locator('html')).toHaveAttribute(
      'data-density',
      appearance.density
    );
    await expect
      .poll(() => readAppearance(options))
      .toEqual(appearance);

    await options.reload();
    await expect(options.getByLabel('主题')).toHaveValue(
      appearance.theme
    );
    await expect(options.getByLabel('密度')).toHaveValue(
      appearance.density
    );
  });
}

function readAppearance(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const key = 'siftmark.settings.appearance.v1';
    return (await chrome.storage.local.get(key))[key];
  });
}
