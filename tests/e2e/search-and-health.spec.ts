import { expect, test } from './fixtures/extension';
import { createRootFolder, readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('finds Chinese bookmarks, checks health, and migrates embeddings', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await disableNativeCapture(manager);
  const folderId = await createRootFolder(manager, '健康检查夹具');
  const bookmarkIds = await manager.evaluate(async (parentId) => {
    const exact = await chrome.bookmarks.create({
      parentId,
      title: '中文性能',
      url: 'http://localhost:43173/article?health=ok'
    });
    const related = await chrome.bookmarks.create({
      parentId,
      title: '中文性能手册',
      url: 'http://localhost:43173/article?health=ok'
    });
    const temporary = await chrome.bookmarks.create({
      parentId,
      title: '暂时不可达页面',
      url: 'http://localhost:43173/health/temporary'
    });
    const dead = await chrome.bookmarks.create({
      parentId,
      title: '永久失效页面',
      url: 'http://localhost:43173/health/dead'
    });
    return {
      exact: exact.id,
      related: related.id,
      temporary: temporary.id,
      dead: dead.id
    };
  }, folderId);

  await manager.reload();
  const search = manager.getByPlaceholder('搜索书签…');
  await search.fill('中文性能');
  const matchingBookmarks = manager.locator(
    '.bookmark-tree-row[data-folder="false"]'
  );
  await expect(matchingBookmarks).toHaveCount(2);
  await expect(matchingBookmarks.first()).toContainText('中文性能');

  await search.fill('健康检查夹具');
  const folderRow = manager
    .locator('.bookmark-tree-row')
    .filter({ hasText: '健康检查夹具' });
  await folderRow.locator('input[type="checkbox"]').check();
  await expect(manager.locator('.selection-count')).toContainText('4');
  await manager.getByRole('button', { name: '检测失效' }).click();
  await expect(manager.locator('.bulk-toolbar output')).toContainText(
    '失效检测完成'
  );

  const metadata = await readDatabaseStore<{
    bookmarkId: string;
    health: string;
  }>(manager, 'bookmarkMetadata');
  const healthByBookmark = new Map(
    metadata.map((row) => [row.bookmarkId, row.health])
  );
  expect(healthByBookmark.get(bookmarkIds.exact)).toBe('healthy');
  expect(healthByBookmark.get(bookmarkIds.related)).toBe('healthy');
  expect(healthByBookmark.get(bookmarkIds.temporary)).toBe('temporary');
  expect(healthByBookmark.get(bookmarkIds.dead)).toBe('dead');

  await configureEmbedding(manager, 'v1', 'http://127.0.0.1:43173/v1');
  await queueEmbeddings(manager);
  await expectEmbeddingTask(manager, 'embedding-index:e2e-embed@v1');
  await expect
    .poll(async () => {
      const rows = await embeddingRows(manager);
      return rows.filter(
        (row) => row.embeddingProfile === 'e2e-embed@v1' && !row.stale
      ).length;
    })
    .toBe(4);

  await configureEmbedding(manager, 'v1', 'http://127.0.0.1:1/v1');
  await search.fill('中文性能');
  await expect(matchingBookmarks).toHaveCount(2);

  await configureEmbedding(manager, 'v2', 'http://127.0.0.1:43173/v1');
  await queueEmbeddings(manager);
  await expectEmbeddingTask(manager, 'embedding-index:e2e-embed@v2');
  await expect
    .poll(async () => {
      const rows = await embeddingRows(manager);
      return {
        oldActive: rows.filter(
          (row) => row.embeddingProfile === 'e2e-embed@v1' && !row.stale
        ).length,
        nextActive: rows.filter(
          (row) => row.embeddingProfile === 'e2e-embed@v2' && !row.stale
        ).length
      };
    })
    .toEqual({ oldActive: 0, nextActive: 4 });
});

async function disableNativeCapture(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.evaluate(() =>
    chrome.storage.local.set({
      'siftmark.settings.smart-bookmark.v1': {
        allowNewFolders: true,
        folderCreationLevel: 'weak',
        smartRename: true,
        renameMaxLength: 12,
        captureNativeBookmarks: false
      }
    })
  );
}

async function configureEmbedding(
  page: import('@playwright/test').Page,
  version: string,
  endpoint: string
): Promise<void> {
  await page.evaluate(
    async ({ profileVersion, profileEndpoint }) => {
      await chrome.storage.local.set({
        'siftmark.ai.profiles.v1': [
          {
            id: 'e2e-embed',
            version: profileVersion,
            name: `Embedding ${profileVersion}`,
            protocol: 'openai-chat',
            endpoint: profileEndpoint,
            model: 'fixture-embedding',
            apiKey: 'e2e-secret-key',
            timeoutMs: 1_000,
            capabilities: ['embed'],
            state: 'verified',
            verifiedAt: Date.now()
          }
        ],
        'siftmark.settings.profile-assignments.v1': {
          embed: `e2e-embed@${profileVersion}`
        }
      });
    },
    { profileVersion: version, profileEndpoint: endpoint }
  );
}

async function queueEmbeddings(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'queue-embeddings' })
  );
}

async function expectEmbeddingTask(
  page: import('@playwright/test').Page,
  id: string
): Promise<void> {
  await expect
    .poll(async () => {
      const tasks = await readDatabaseStore<{ id: string; state: string }>(
        page,
        'tasks'
      );
      return tasks.find((task) => task.id === id)?.state;
    })
    .toBe('succeeded');
}

async function embeddingRows(page: import('@playwright/test').Page) {
  return readDatabaseStore<{
    kind: string;
    embeddingProfile?: string;
    stale?: boolean;
  }>(page, 'searchIndex').then((rows) =>
    rows.filter((row) => row.kind === 'embedding')
  );
}
