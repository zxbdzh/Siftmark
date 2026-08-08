import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type Page
} from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { completeOnboarding } from './fixtures/chrome-state';

interface ExtensionSession {
  context: BrowserContext;
  extensionId: string;
  profilePath: string;
}

async function launchExtension(): Promise<ExtensionSession> {
  const extensionPath = path.join(process.cwd(), '.output', 'chrome-mv3');
  const profilePath = await mkdtemp(
    path.join(tmpdir(), 'siftmark-playwright-')
  );
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  return { context, extensionId: new URL(worker.url()).host, profilePath };
}

async function closeExtension(
  session: ExtensionSession | undefined
): Promise<void> {
  await session?.context.close();
  if (session) await rm(session.profilePath, { recursive: true, force: true });
}

async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  pageName: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${pageName}.html`);
  return page;
}

test('loads popup, manager, options, and the background worker', async () => {
  let session: ExtensionSession | undefined;
  try {
    session = await launchExtension();
    const { context, extensionId } = session;
    const popup = await openExtensionPage(context, extensionId, 'popup');
    await expect(popup.locator('.brand-type')).toHaveText('Siftmark');
    await expect(popup.getByRole('button', { name: '保存书签' })).toBeVisible();
    const manager = await openExtensionPage(context, extensionId, 'manager');
    await expect(
      manager.getByRole('complementary', { name: '文件夹', exact: true })
    ).toBeVisible();
    await expect(manager.getByRole('main', { name: '书签列表' })).toBeVisible();
    await expect(manager.getByLabel('搜索书签')).toBeVisible();
    await manager.getByRole('tab', { name: '通知' }).click();
    await expect(manager.getByRole('main', { name: '通知中心' })).toBeVisible();
    await manager.getByRole('tab', { name: '统计' }).click();
    await expect(manager.getByRole('main', { name: '访问统计' })).toBeVisible();
    await manager.getByRole('tab', { name: '书签' }).click();
    await manager.setViewportSize({ width: 390, height: 844 });
    await expect(
      manager.getByRole('button', { name: '打开文件夹' })
    ).toBeVisible();
    await completeOnboarding(manager);
    const options = await openExtensionPage(context, extensionId, 'options');
    await expect(
      options.getByRole('heading', { name: '设置', exact: true })
    ).toBeVisible();
  } finally {
    await closeExtension(session);
  }
});

test('passes Gate 3 save, edit, keyboard, move, review, theme, and responsive workflows', async () => {
  test.setTimeout(90_000);
  let session: ExtensionSession | undefined;
  try {
    session = await launchExtension();
    const { context, extensionId } = session;
    const manager = await openExtensionPage(context, extensionId, 'manager');
    const fixture = await manager.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      const root = tree[0]?.children?.find((node) => !node.url) ?? tree[0];
      if (!root) throw new Error('Missing bookmark root');
      const source = await chrome.bookmarks.create({
        parentId: root.id,
        title: 'Gate 3 来源'
      });
      const destination = await chrome.bookmarks.create({
        parentId: root.id,
        title: 'Gate 3 目标'
      });
      const bookmarks = [];
      for (let index = 1; index <= 3; index++)
        bookmarks.push(
          await chrome.bookmarks.create({
            parentId: source.id,
            title: `规格书签 ${index}`,
            url: `https://siftmark.test/${index}`
          })
        );
      return {
        sourceId: source.id,
        destinationId: destination.id,
        bookmark1Id: bookmarks[0]!.id,
        bookmark2Id: bookmarks[1]!.id,
        bookmark3Id: bookmarks[2]!.id
      };
    });
    await manager.reload();
    await manager
      .getByRole('treeitem', { name: 'Gate 3 来源' })
      .click({ button: 'right' });
    await expect(
      manager.getByRole('button', { name: '健康检查' })
    ).toBeEnabled();
    manager.once('dialog', (dialog) => void dialog.accept('Gate 3 子文件夹'));
    await manager.getByRole('button', { name: '新建子文件夹' }).click();
    await expect(
      manager.getByRole('treeitem', { name: 'Gate 3 子文件夹' })
    ).toBeVisible();
    await manager.getByRole('treeitem', { name: 'Gate 3 来源' }).click();
    await manager.getByLabel('排序字段').selectOption('title');
    await manager.getByRole('button', { name: '当前升序，切换为降序' }).click();
    await manager.reload();
    await manager.getByRole('treeitem', { name: 'Gate 3 来源' }).click();
    await expect(manager.getByLabel('排序字段')).toHaveValue('title');
    await expect(
      manager.getByRole('button', { name: '当前降序，切换为升序' })
    ).toBeVisible();
    await manager.getByRole('button', { name: /规格书签 1/ }).click();
    await manager.getByLabel('标题').fill('规格书签 已更新');
    await manager.getByRole('button', { name: '保存详情' }).click();
    await expect(manager.getByRole('status')).toHaveText('详情已保存');
    await expect
      .poll(() =>
        manager.evaluate(
          async (id) =>
            new Promise<string | undefined>((resolve) =>
              chrome.bookmarks.get(id, (nodes) => resolve(nodes[0]?.title))
            ),
          fixture.bookmark1Id
        )
      )
      .toBe('规格书签 已更新');

    const bookmarkGroup = manager.getByRole('group', {
      name: '当前文件夹书签'
    });
    await bookmarkGroup.focus();
    await bookmarkGroup.press('End');
    await expect(
      manager.locator('.bookmark-row[aria-pressed="true"]')
    ).toHaveCount(1);
    await bookmarkGroup.press('Shift+Home');
    await expect(
      manager.locator('.bookmark-row[aria-pressed="true"]')
    ).toHaveCount(3);

    await manager.reload();
    await manager.getByRole('treeitem', { name: 'Gate 3 来源' }).click();
    await manager
      .getByRole('button', { name: /规格书签 已更新/ })
      .click({ button: 'right' });
    await manager.getByRole('button', { name: '移动到…' }).click();
    await manager
      .getByRole('listbox', { name: '目标文件夹' })
      .getByRole('option', { name: 'Gate 3 目标' })
      .click();
    await expect
      .poll(() =>
        manager.evaluate(
          async (id) =>
            new Promise<string | undefined>((resolve) =>
              chrome.bookmarks.get(id, (nodes) => resolve(nodes[0]?.parentId))
            ),
          fixture.bookmark1Id
        )
      )
      .toBe(fixture.destinationId);

    await manager.evaluate(
      async ({ id, parentId }) => {
        const request = indexedDB.open('siftmark');
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction(
          'analysisProposals',
          'readwrite'
        );
        transaction
          .objectStore('analysisProposals')
          .put({
            id: 'gate3-proposal',
            bookmarkId: id,
            sourceSnapshot: {
              id,
              parentId,
              index: 1,
              title: '规格书签 2',
              url: 'https://siftmark.test/2'
            },
            result: {
              folderPath: [],
              title: 'AI 审核标题',
              tags: ['测试'],
              summary: '审核摘要',
              confidence: 'medium',
              reason: '字段级审核验证'
            },
            state: 'pending',
            createdAt: Date.now()
          });
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      },
      { id: fixture.bookmark2Id, parentId: fixture.sourceId }
    );
    await manager.reload();
    await manager.getByRole('tab', { name: '审核' }).click();
    await expect(
      manager.getByRole('heading', { name: 'AI 审核标题' })
    ).toBeVisible();
    await manager.getByLabel('folder').uncheck();
    await manager.getByLabel('tags').uncheck();
    await manager.getByLabel('summary').uncheck();
    await manager.getByRole('button', { name: '应用所选字段' }).click();
    await expect
      .poll(() =>
        manager.evaluate(
          async (id) =>
            new Promise<string | undefined>((resolve) =>
              chrome.bookmarks.get(id, (nodes) => resolve(nodes[0]?.title))
            ),
          fixture.bookmark2Id
        )
      )
      .toBe('AI 审核标题');

    const draftId = 'gate3-note-draft';
    await manager.evaluate(
      async (id) =>
        chrome.storage.local.set({
          [`siftmark.note-draft.${id}`]: {
            id,
            text: 'Gate 3 选中文本草稿',
            title: '草稿来源页面',
            url: 'https://siftmark.test/draft',
            createdAt: Date.now(),
            truncated: false
          }
        }),
      draftId
    );
    await manager.reload();
    await manager.getByRole('tab', { name: '草稿' }).click();
    await expect(
      manager.getByRole('heading', { name: '笔记草稿' })
    ).toBeVisible();
    await expect(manager.getByText('Gate 3 选中文本草稿')).toBeVisible();
    await manager.getByRole('button', { name: '删除' }).click();
    await expect(manager.getByText('暂无选中文本草稿')).toBeVisible();
    await expect
      .poll(() =>
        manager.evaluate(
          async (id) =>
            (await chrome.storage.local.get(`siftmark.note-draft.${id}`))[
              `siftmark.note-draft.${id}`
            ],
          draftId
        )
      )
      .toBeUndefined();

    const content = await context.newPage();
    await content.route('http://127.0.0.1:4173/article', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Popup 保存验证</title><h1>Popup 保存验证</h1>'
      })
    );
    await content.goto('http://127.0.0.1:4173/article');
    await manager.evaluate(async () =>
      chrome.storage.local.set({
        'siftmark.content.floating': false,
        'siftmark.content.hidden.127.0.0.1': false
      })
    );
    await content.reload();
    await expect(content.locator('#siftmark-root')).toHaveCount(0);
    await manager.evaluate(async () =>
      chrome.storage.local.set({ 'siftmark.content.floating': true })
    );
    await content.reload();
    await expect(
      content.getByRole('button', { name: '保存到 Siftmark' })
    ).toBeVisible();
    await content.getByRole('button', { name: '在此网站隐藏' }).click();
    await expect(content.locator('#siftmark-root')).toHaveCount(0);
    await content.reload();
    await expect(content.locator('#siftmark-root')).toHaveCount(0);
    const contentTabId = await manager.evaluate(
      () =>
        new Promise<number>((resolve) =>
          chrome.tabs.query({ url: 'http://127.0.0.1:4173/article' }, (tabs) =>
            resolve(tabs[0]!.id!)
          )
        )
    );
    await context.addInitScript(
      ({ id, url, title }) => {
        if (!globalThis.chrome?.tabs) return;
        const original = chrome.tabs.query.bind(chrome.tabs);
        Object.defineProperty(chrome.tabs, 'query', {
          configurable: true,
          value: (
            queryInfo: chrome.tabs.QueryInfo,
            callback?: (tabs: chrome.tabs.Tab[]) => void
          ) => {
            if (queryInfo.active && queryInfo.currentWindow) {
              const tabs = [{ id, url, title }] as chrome.tabs.Tab[];
              if (callback) {
                callback(tabs);
                return;
              }
              return Promise.resolve(tabs);
            }
            return original(queryInfo, callback!);
          }
        });
      },
      {
        id: contentTabId,
        url: 'http://127.0.0.1:4173/article',
        title: 'Popup 保存验证'
      }
    );
    const popup = await context.newPage();
    await content.bringToFront();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(
      popup.getByRole('heading', { name: 'Popup 保存验证' })
    ).toBeVisible();
    await popup.getByLabel('保存到').selectOption(fixture.sourceId);
    await popup.getByRole('button', { name: '保存书签' }).click();
    await expect(popup.getByRole('status')).toContainText('已保存');
    await expect
      .poll(() =>
        manager.evaluate(
          async () =>
            (
              await chrome.bookmarks.search({
                url: 'http://127.0.0.1:4173/article'
              })
            ).length
        )
      )
      .toBe(1);
    await popup.setViewportSize({ width: 360, height: 640 });
    await mkdir(path.join(process.cwd(), 'tests', 'visual'), {
      recursive: true
    });
    await popup.screenshot({
      path: path.join(process.cwd(), 'tests', 'visual', 'gate3-popup.png'),
      fullPage: true
    });

    await completeOnboarding(manager);
    const options = await openExtensionPage(context, extensionId, 'options');
    await options.getByLabel('主题').selectOption('dark');
    await expect(options.locator('html')).toHaveAttribute('data-theme', 'dark');
    await options.screenshot({
      path: path.join(
        process.cwd(),
        'tests',
        'visual',
        'gate3-options-dark.png'
      ),
      fullPage: true
    });
    await manager.setViewportSize({ width: 1440, height: 900 });
    await manager.reload();
    await expect(manager.locator('html')).toHaveAttribute('data-theme', 'dark');
    await manager.screenshot({
      path: path.join(
        process.cwd(),
        'tests',
        'visual',
        'gate3-manager-wide.png'
      ),
      fullPage: true
    });
    await manager.setViewportSize({ width: 390, height: 844 });
    await expect(
      manager.getByRole('button', { name: '打开文件夹' })
    ).toBeVisible();
    await manager.getByRole('button', { name: '打开文件夹' }).click();
    await expect(manager.getByRole('dialog', { name: '文件夹' })).toBeVisible();
    await manager.screenshot({
      path: path.join(
        process.cwd(),
        'tests',
        'visual',
        'gate3-manager-narrow.png'
      ),
      fullPage: true
    });
  } finally {
    await closeExtension(session);
  }
});
