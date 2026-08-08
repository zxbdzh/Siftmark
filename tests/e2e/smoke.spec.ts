import { extensionPath, expect, test } from './fixtures/extension';
import {
  openExtensionPage,
  resolveExtensionPages
} from './helpers/extension-pages';

test('loads popup, manager, options, and background worker without console errors', async ({
  context,
  extensionId
}) => {
  expect(context.serviceWorkers()).toHaveLength(1);
  const paths = await resolveExtensionPages(extensionPath);
  for (const pagePath of Object.values(paths)) {
    const page = await openExtensionPage(context, extensionId, pagePath);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await expect(page.getByText('Siftmark').first()).toBeVisible();
    expect(errors).toEqual([]);
  }
});
