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
  await expect(popup.getByRole('tab', { name: /任务/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(popup.getByRole('tab', { name: /回执/ })).toBeVisible();
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

test('loads the side panel without extension module-preload warnings', async ({
  context,
  extensionId
}) => {
  const sidePanel = await context.newPage();
  const preloadWarnings: string[] = [];
  sidePanel.on('console', (message) => {
    if (/preload|cross-world extension resource mismatch/i.test(message.text()))
      preloadWarnings.push(message.text());
  });

  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(sidePanel).toHaveTitle('Siftmark Agent');
  await expect(sidePanel.getByText('没有进行中的收藏')).toBeVisible();
  expect(preloadWarnings).toEqual([]);
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
      activities: [
        {
          id: 'capture',
          kind: 'capture',
          status: 'completed',
          label: '原生书签已保存',
          detail: '收藏先保存在浏览器中，分析失败也不会丢失',
          facts: [
            { label: '触发入口', value: '浏览器原生收藏' },
            { label: '保存顺序', value: '先保存，再分析' }
          ],
          durationMs: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: 'page-context',
          kind: 'page',
          status: 'completed',
          label: '网页内容已准备',
          detail: '已提取标题、描述与正文用于本次归类',
          facts: [
            { label: '描述', value: '86 字符' },
            { label: '正文', value: '3,420 字符' },
            { label: '页面截图', value: '当前可见区域已准备' },
            { label: '隐私处理', value: '网址参数在发送前移除' }
          ],
          durationMs: 18,
          createdAt: timestamp + 1,
          updatedAt: timestamp + 19
        },
        {
          id: 'folder-candidates',
          kind: 'folders',
          status: 'completed',
          label: '已比较候选目录',
          detail: '比较了 12 个相关目录，并结合目录深度与本地偏好排序',
          facts: [
            { label: '目录总数', value: '48 个' },
            { label: '送入模型', value: '12 个候选' },
            { label: '本地信号', value: '2 条偏好或记忆' },
            { label: '推荐深度', value: '2 级' }
          ],
          durationMs: 42,
          createdAt: timestamp + 20,
          updatedAt: timestamp + 62
        },
        {
          id: 'vision',
          kind: 'vision',
          status: 'completed',
          label: '模型服务已确认图片输入',
          detail: '当前可见区域仅用于本次判断，未写入收藏会话',
          facts: [
            { label: '服务确认', value: '图片输入已接受' },
            { label: '持久化', value: '截图未写入收藏会话' }
          ],
          durationMs: 580,
          createdAt: timestamp + 63,
          updatedAt: timestamp + 643
        },
        {
          id: 'web-search',
          kind: 'web-search',
          status: 'completed',
          label: '联网搜索已完成',
          detail: '模型服务返回了标准 web_search 工具调用记录',
          facts: [{ label: '工具证据', value: '返回标准搜索调用记录' }],
          durationMs: 910,
          createdAt: timestamp + 644,
          updatedAt: timestamp + 1554
        },
        {
          id: 'model-analysis',
          kind: 'model',
          status: 'completed',
          label: 'AI 已生成归类方案',
          detail: '内容与 Agent 产品研究相关，建议归入研究目录。',
          facts: [
            { label: '建议位置', value: 'Agent 验收目录 / 研究' },
            { label: '置信度', value: '中' },
            { label: '建议标题', value: 'Agent 建议标题' },
            { label: '内容标签', value: '验收、Agent' }
          ],
          durationMs: 1620,
          createdAt: timestamp + 1555,
          updatedAt: timestamp + 3175
        },
        {
          id: 'risk-check',
          kind: 'risk',
          status: 'completed',
          label: '风险检查完成',
          detail: '发现 1 项需要批准的风险',
          facts: [
            { label: '审批结论', value: '风险方案，需要用户批准' },
            { label: '命中规则', value: '新建目录' }
          ],
          durationMs: 7,
          createdAt: timestamp + 3176,
          updatedAt: timestamp + 3183
        },
        {
          id: 'execution',
          kind: 'execution',
          status: 'skipped',
          label: '等待批准后执行',
          detail: '尚未调用本地书签接口',
          facts: [{ label: '写入状态', value: '未执行' }],
          durationMs: 0,
          createdAt: timestamp + 3184,
          updatedAt: timestamp + 3184
        }
      ],
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
  await expect(
    sidePanel.getByRole('heading', { name: 'Agent 建议标题' })
  ).toBeVisible();
  await expect(sidePanel.getByRole('list', { name: '收藏位置' })).toContainText(
    '研究'
  );
  await expect(sidePanel.getByText('将新建目录')).toBeVisible();
  await expect(sidePanel.getByText('当前网页')).toBeVisible();
  await expect(
    sidePanel.getByRole('heading', { name: '分析过程' })
  ).toBeVisible();
  await expect(sidePanel.getByText('8 / 8 完成')).toBeVisible();
  await expect(sidePanel.getByText('模型服务已确认图片输入')).toBeVisible();
  await expect(sidePanel.getByText('联网搜索已完成')).toBeVisible();
  await expect(sidePanel.getByText('返回标准搜索调用记录')).toBeVisible();
  await expect(sidePanel.getByText('1.6 s')).toBeVisible();
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
  await sidePanel.locator('.analysis-trace').scrollIntoViewIfNeeded();
  await expect(sidePanel.locator('.analysis-trace')).toBeInViewport();
  expect(
    await sidePanel
      .locator('.analysis-trace')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
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
          title: 'Agent 建议标题',
          activities: [
            {
              id: 'risk-check',
              kind: 'risk',
              status: 'completed',
              label: '风险检查完成',
              detail: '发现 1 项需要批准的风险',
              facts: [
                { label: '审批结论', value: '风险方案，需要用户批准' },
                { label: '命中规则', value: '新建目录' }
              ],
              durationMs: 7,
              createdAt: 1,
              updatedAt: 8
            }
          ]
        }
      }),
    tabId
  );
  const approval = article.getByRole('dialog', {
    name: '批准这次整理吗？'
  });
  await expect(approval).toContainText('Agent 验收目录');
  await expect(approval).toContainText('研究');
  await expect(approval).toContainText('分析过程');
  await expect(approval).toContainText('风险检查完成');
  const analysisTrace = approval.locator('.siftmark-processing-trace');
  const analysisList = approval.getByRole('list', { name: '分析过程' });
  await expect(analysisTrace).not.toHaveAttribute('open', '');
  await expect(analysisList).not.toBeVisible();
  await expect(
    approval.getByRole('button', { name: '与 Agent 调整' })
  ).toBeVisible();
  await analysisTrace.locator('summary').click();
  await expect(analysisList).toBeVisible();
  await expect(approval.getByText('命中规则')).toBeVisible();
  expect(
    await approval
      .locator('.siftmark-trace-details')
      .evaluate((element) => getComputedStyle(element).overflowY)
  ).toBe('auto');
  expect(
    await approval
      .locator('.siftmark-overlay-actions')
      .evaluate((element) => getComputedStyle(element).position)
  ).toBe('sticky');
  await article.keyboard.press('Escape');
  await expect(approval).toHaveCount(0);
  await expect(article.getByRole('button')).toHaveCount(0);
});
