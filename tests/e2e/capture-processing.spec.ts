import { expect, test } from './fixtures/extension';
import { putDatabaseRecord } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('animates the capture processing indicator', async ({
  context,
  extensionId
}) => {
  const popup = await openProcessingPopup(context, extensionId, 'animated');
  const indicator = popup.locator('.working-indicator i');
  await expect(indicator).toBeVisible();

  const firstFrame = await readAnimatedStyle(indicator);
  await popup.waitForTimeout(300);
  const secondFrame = await readAnimatedStyle(indicator);
  expect(secondFrame).not.toEqual(firstFrame);
});

test('keeps the processing indicator stable with reduced motion', async ({
  context,
  extensionId
}) => {
  const popup = await openProcessingPopup(
    context,
    extensionId,
    'reduced',
    true
  );
  const indicator = popup.locator('.working-indicator i');
  await expect(indicator).toBeVisible();

  const firstFrame = await readAnimatedStyle(indicator);
  await popup.waitForTimeout(300);
  const secondFrame = await readAnimatedStyle(indicator);
  expect(secondFrame).toEqual(firstFrame);
});

async function readAnimatedStyle(
  indicator: import('@playwright/test').Locator
): Promise<{ opacity: string; transform: string }> {
  return indicator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform };
  });
}

async function openProcessingPopup(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  flow: string,
  reducedMotion = false
) {
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const timestamp = Date.now();
  await putDatabaseRecord(manager, 'captureSessions', {
    id: `processing-${flow}`,
    bookmarkId: `bookmark-${flow}`,
    state: 'analyzing',
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + 60_000,
    payload: {
      id: `processing-${flow}`,
      bookmarkId: `bookmark-${flow}`,
      trigger: 'native-bookmark',
      sourceSnapshot: {
        id: `bookmark-${flow}`,
        parentId: '1',
        index: 0,
        title: `处理中-${flow}`,
        url: `https://example.test/${flow}`
      },
      state: 'analyzing',
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + 60_000
    }
  });
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  if (reducedMotion) await popup.emulateMedia({ reducedMotion: 'reduce' });
  await popup.reload();
  await expect(
    popup.getByRole('heading', { name: `处理中-${flow}` })
  ).toBeVisible();
  return popup;
}
