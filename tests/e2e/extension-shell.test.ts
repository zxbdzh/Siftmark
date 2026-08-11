import { expect, test } from './fixtures/extension';
import { putDatabaseRecord } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('loads the current popup, manager, options, side panel, and worker', async ({
  context,
  extensionId
}) => {
  const [worker] = context.serviceWorkers();
  expect(worker?.url()).toContain(`chrome-extension://${extensionId}/`);

  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await expect(popup.locator('.brand-type')).toHaveText('Siftmark');
  await expect(popup.getByRole('heading', { name: '待处理' })).toBeVisible();
  await expect(popup.getByRole('heading', { name: '最近结果' })).toBeVisible();
  await expect(popup.getByText('没有待确认的收藏')).toBeVisible();

  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await expect(manager.getByText('Siftmark · 书签树')).toBeVisible();
  await expect(manager.getByPlaceholder('搜索书签…')).toBeVisible();
  await expect(manager.getByRole('button', { name: '批量排序' })).toBeVisible();

  const options = await openExtensionPage(context, extensionId, 'options.html');
  await expect(
    options.getByRole('heading', { name: '设置', exact: true })
  ).toBeVisible();
  await expect(
    options.getByRole('heading', { name: '智能收藏' })
  ).toBeVisible();
  await expect(
    options.getByRole('slider', { name: '单次最多新建层级' })
  ).toBeVisible();
  await expect(
    options.getByRole('slider', { name: '推荐目录深度' })
  ).toBeVisible();
  await expect(
    options.getByRole('heading', { name: 'Agent 固定规则' })
  ).toBeVisible();

  const sidePanel = await openExtensionPage(
    context,
    extensionId,
    'sidepanel.html'
  );
  await expect(sidePanel.getByText('没有进行中的收藏')).toBeVisible();
});

test('supports the bookmark tree, Agent proposal, and in-page approval shell', async ({
  context,
  extensionId
}) => {
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  const fixture = await manager.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0]?.children?.find((node) => !node.url) ?? tree[0];
    if (!root) throw new Error('Missing bookmark root');
    const folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: 'Agent 验收目录'
    });
    const bookmark = await chrome.bookmarks.create({
      parentId: folder.id,
      title: '可搜索的 Agent 收藏',
      url: 'https://shell.siftmark.test/article'
    });
    return { folder, bookmark };
  });

  await manager.reload();
  await manager.getByPlaceholder('搜索书签…').fill('可搜索的 Agent 收藏');
  const bookmarkRow = manager
    .locator('.bookmark-tree-row')
    .filter({ hasText: '可搜索的 Agent 收藏' });
  await expect(bookmarkRow).toBeVisible();
  await bookmarkRow.locator('input[type="checkbox"]').check();
  await expect(manager.locator('.selection-count')).toContainText('1');

  const timestamp = Date.now();
  await putDatabaseRecord(manager, 'captureSessions', {
    id: 'shell-agent-session',
    bookmarkId: fixture.bookmark.id,
    state: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + 60_000,
    payload: {
      id: 'shell-agent-session',
      bookmarkId: fixture.bookmark.id,
      trigger: 'native-bookmark',
      sourceSnapshot: {
        id: fixture.bookmark.id,
        parentId: fixture.folder.id,
        index: 0,
        title: '可搜索的 Agent 收藏',
        url: 'https://shell.siftmark.test/article'
      },
      state: 'pending',
      plan: {
        destination: {
          folderId: fixture.folder.id,
          path: [{ id: fixture.folder.id, title: 'Agent 验收目录' }],
          newFolders: ['研究']
        },
        title: 'Agent 建议标题',
        tags: ['验收'],
        summary: '用于验证 Side Panel。',
        confidence: 'medium',
        reason: '需要创建一级目录。',
        relatedBookmarks: [],
        generatedAt: timestamp
      },
      risk: {
        decision: 'approval',
        reasons: ['new-folder'],
        canExecute: true
      },
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + 60_000
    }
  });

  const sidePanel = await openExtensionPage(
    context,
    extensionId,
    'sidepanel.html?session=shell-agent-session'
  );
  await expect(sidePanel.getByText('Siftmark Agent')).toBeVisible();
  await expect(sidePanel.getByText('Agent 建议标题')).toBeVisible();
  await expect(sidePanel.getByRole('list', { name: '收藏位置' })).toContainText(
    '研究'
  );
  await expect(sidePanel.getByText('将新建目录')).toBeVisible();
  await expect(sidePanel.getByText('当前网页')).toBeVisible();
  await expect(sidePanel.getByText('查看 AI 分析')).toBeVisible();
  await expect(
    sidePanel.getByRole('button', { name: '不要新建目录' })
  ).toBeVisible();
  await expect(
    sidePanel.getByRole('textbox', { name: '调整收藏方案' })
  ).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: '允许' })).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: '拒绝' })).toBeVisible();

  await sidePanel.setViewportSize({ width: 300, height: 600 });
  await expect(
    sidePanel.getByRole('textbox', { name: '调整收藏方案' })
  ).toBeInViewport();
  await expect(
    sidePanel.getByRole('button', { name: '允许' })
  ).toBeInViewport();
  await expect(
    sidePanel.getByRole('button', { name: '拒绝' })
  ).toBeInViewport();
  expect(
    await sidePanel.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  ).toBe(true);

  const article = await context.newPage();
  await article.route('http://127.0.0.1:43173/shell', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>网页审批浮层</title><h1>网页审批浮层</h1>'
    })
  );
  await article.goto('http://127.0.0.1:43173/shell');
  await expect(article.locator('#siftmark-root')).toHaveCount(1);
  await expect(article.getByRole('button')).toHaveCount(0);
  const tabId = await manager.evaluate(
    () =>
      new Promise<number>((resolve) =>
        chrome.tabs.query({ url: 'http://127.0.0.1:43173/shell' }, (tabs) =>
          resolve(tabs[0]!.id!)
        )
      )
  );
  await manager.evaluate(
    (targetTabId) =>
      chrome.tabs.sendMessage(targetTabId, {
        type: 'capture-agent-overlay',
        view: {
          sessionId: 'shell-agent-session',
          phase: 'approval',
          destinationPath: ['书签栏', 'Agent 验收目录'],
          newFolderName: '研究',
          title: 'Agent 建议标题'
        }
      }),
    tabId
  );
  const approval = article.getByRole('dialog', {
    name: '批准这次整理吗？'
  });
  await expect(approval).toContainText('Agent 验收目录');
  await expect(approval).toContainText('研究');
  await expect(
    approval.getByRole('button', { name: '与 Agent 调整' })
  ).toBeVisible();
  await article.keyboard.press('Escape');
  await expect(approval).toHaveCount(0);
  await expect(article.getByRole('button')).toHaveCount(0);
});
