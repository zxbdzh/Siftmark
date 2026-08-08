import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';

interface BuiltManifest {
  action?: { default_popup?: string };
  options_ui?: { page?: string };
}

export interface ExtensionPages {
  popup: string;
  manager: string;
  options: string;
}

export async function resolveExtensionPages(
  extensionPath: string
): Promise<ExtensionPages> {
  const manifest = JSON.parse(
    await readFile(path.join(extensionPath, 'manifest.json'), 'utf8')
  ) as BuiltManifest;
  return {
    popup: manifest.action?.default_popup ?? 'popup.html',
    options: manifest.options_ui?.page ?? 'options.html',
    manager: await firstExisting(extensionPath, [
      'manager.html',
      'manager/index.html'
    ])
  };
}

export async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  pagePath: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${pagePath}`);
  return page;
}

async function firstExisting(root: string, candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await stat(path.join(root, candidate));
      return candidate;
    } catch {
      // Try the next WXT output convention.
    }
  }
  throw new Error('WXT manager entrypoint was not found in the build output');
}
