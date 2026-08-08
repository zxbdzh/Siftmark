import { expect, test } from './fixtures/extension';
import { createRootFolder, readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('finds Chinese bookmarks and completes a local health scan', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const folderId = await createRootFolder(manager, '健康检查夹具');
  const bookmarkIds = await manager.evaluate(async (parentId) => {
    const exact = await chrome.bookmarks.create({
      parentId,
      title: '中文性能',
      url: 'http://localhost:4173/article?health=ok'
    });
    const related = await chrome.bookmarks.create({
      parentId,
      title: '中文性能手册',
      url: 'http://localhost:4173/article?health=ok'
    });
    const temporary = await chrome.bookmarks.create({
      parentId,
      title: '暂时不可达页面',
      url: 'http://localhost:4173/health/temporary'
    });
    const dead = await chrome.bookmarks.create({
      parentId,
      title: '永久失效页面',
      url: 'http://localhost:4173/health/dead'
    });
    return {
      exact: exact.id,
      related: related.id,
      temporary: temporary.id,
      dead: dead.id
    };
  }, folderId);
  await manager.reload();
  const search = manager.getByLabel('搜索书签');
  await search.fill('中文性能');
  await expect(manager.locator('.bookmark-title').first()).toHaveText(
    '中文性能'
  );
  await expect(manager.getByText('本地搜索 · 2 项')).toBeVisible();
  await manager.getByLabel('搜索书签').fill('');
  await manager.getByRole('treeitem', { name: '健康检查夹具' }).click({
    button: 'right'
  });
  await manager.getByRole('button', { name: '健康检查' }).click();
  await expect
    .poll(async () => {
      const tasks = await readDatabaseStore<{ type: string; state: string }>(
        manager,
        'tasks'
      );
      return tasks.find((task) => task.type === 'scan-health')?.state;
    })
    .toBe('succeeded');
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
  const healthProposals = await readDatabaseStore<{
    category?: string;
    state: string;
    relatedBookmarkIds?: string[];
  }>(manager, 'analysisProposals');
  expect(
    healthProposals.find((proposal) => proposal.category === 'duplicate')
  ).toMatchObject({
    state: 'duplicate',
    relatedBookmarkIds: expect.arrayContaining([
      bookmarkIds.exact,
      bookmarkIds.related
    ])
  });
  expect(
    healthProposals.find((proposal) => proposal.category === 'dead')
  ).toMatchObject({ state: 'dead' });

  await manager.reload();
  await manager.getByRole('tab', { name: '审核' }).click();
  await manager.getByRole('button', { name: '重复' }).click();
  await expect(
    manager.getByRole('button', { name: '合并元数据并标记已处理' })
  ).toBeVisible();
  await manager.getByRole('button', { name: '失效' }).click();
  await expect(
    manager.getByRole('button', { name: '标记已处理' })
  ).toBeVisible();

  await configureEmbedding(manager, 'v1', 'http://127.0.0.1:4173/v1');
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
  await manager.reload();
  await expect(manager.getByText('混合搜索')).toBeVisible();
  await manager.getByLabel('搜索书签').fill('中文性能');
  await expect(manager.locator('.bookmark-title').first()).toHaveText(
    '中文性能'
  );

  await configureEmbedding(manager, 'v2', 'http://127.0.0.1:4173/v1');
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
