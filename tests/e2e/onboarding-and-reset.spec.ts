import { expect, test } from './fixtures/extension';
import { putDatabaseRecord, readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('opens settings directly and resets Siftmark data without deleting native bookmarks', async ({
  context,
  extensionId
}) => {
  const options = await openExtensionPage(context, extensionId, 'options.html');
  await expect(
    options.getByRole('heading', { name: '设置', exact: true })
  ).toBeVisible();
  await expect(
    options.getByRole('heading', { name: '智能收藏' })
  ).toBeVisible();
  expect(
    await options.evaluate(
      async () =>
        (await chrome.storage.local.get('siftmark.onboarding.v1'))[
          'siftmark.onboarding.v1'
        ]
    )
  ).toBeUndefined();

  const fixture = await options.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0]?.children?.find((node) => !node.url) ?? tree[0];
    if (!root) throw new Error('Missing native bookmark root');
    const folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: '重置验证样本'
    });
    const first = await chrome.bookmarks.create({
      parentId: folder.id,
      title: '重置后保留',
      url: 'https://reset.siftmark.test/keep'
    });
    const second = await chrome.bookmarks.create({
      parentId: folder.id,
      title: '第二个原生书签',
      url: 'https://reset.siftmark.test/second'
    });
    return { first, second };
  });
  const before = await options.evaluate(() => chrome.bookmarks.getTree());
  const timestamp = Date.now();

  await putDatabaseRecord(options, 'bookmarkMetadata', {
    bookmarkId: fixture.first.id,
    summary: '将被重置',
    tags: [],
    note: '',
    confidence: 'unknown',
    reason: '',
    health: 'unchecked',
    updatedAt: timestamp
  });
  await putDatabaseRecord(options, 'bookmarkMetadata', {
    bookmarkId: fixture.second.id,
    summary: '第二条元数据',
    tags: [],
    note: '',
    confidence: 'low',
    reason: '',
    health: 'dead',
    updatedAt: timestamp
  });
  await putDatabaseRecord(options, 'thumbnails', {
    bookmarkId: fixture.first.id,
    blob: { size: 3 },
    state: 'ready',
    createdAt: timestamp,
    lastAccessedAt: timestamp
  });
  await putDatabaseRecord(options, 'searchIndex', {
    id: `keyword:${fixture.first.id}`,
    kind: 'keyword',
    bookmarkId: fixture.first.id,
    keywordTokens: ['重置'],
    updatedAt: timestamp
  });
  await putDatabaseRecord(options, 'operationLog', {
    id: 'reset-operation',
    type: 'update',
    bookmarkId: fixture.first.id,
    before: {},
    after: {},
    idempotencyKey: 'reset-operation-key',
    createdAt: timestamp
  });
  await putDatabaseRecord(options, 'tasks', {
    id: 'reset-task',
    type: 'scan',
    state: 'queued',
    input: {},
    completed: 0,
    failed: 0,
    retryCount: 0,
    idempotencyKey: 'reset-task-key',
    createdAt: timestamp,
    updatedAt: timestamp
  });
  await putDatabaseRecord(options, 'captureSessions', {
    id: 'reset-capture-session',
    bookmarkId: fixture.first.id,
    state: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + 60_000,
    payload: { id: 'reset-capture-session', state: 'pending' }
  });
  await putDatabaseRecord(options, 'capturePreferences', {
    id: 'reset-capture-preference',
    kind: 'fixed-rule',
    domain: 'reset.siftmark.test',
    updatedAt: timestamp,
    payload: {
      id: 'reset-capture-preference',
      kind: 'fixed-rule',
      domain: 'reset.siftmark.test'
    }
  });
  await options.evaluate(async () => {
    await chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [{ id: 'reset-profile' }],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'reset-profile@v1',
        agent: 'reset-profile@v1'
      }
    });
  });

  const reset = options.locator('.reset-section');
  const resetPreview = reset.locator('.reset-preview');
  const previewScope = async (scope: string) => {
    await reset.getByLabel('重置范围').selectOption(scope);
    await reset.getByRole('button', { name: '预览影响' }).click();
    await expect(reset.getByText('已生成重置预览')).toBeVisible();
  };

  await previewScope('cache-thumbnails');
  await expect(
    resetPreview.getByText('缩略图缓存', { exact: true }).locator('..')
  ).toContainText('1 项 · 3 B');
  await previewScope('ai-metadata-index');
  await expect(
    resetPreview.getByText('书签元数据', { exact: true }).locator('..')
  ).toContainText('2 项');
  await expect(
    resetPreview.getByText('搜索索引', { exact: true }).locator('..')
  ).toContainText('1 项');
  await expect(resetPreview.getByText(/合计 3 项/)).toBeVisible();
  await previewScope('history-tasks');
  await expect(
    resetPreview.getByText('操作历史', { exact: true }).locator('..')
  ).toContainText('1 项');
  await expect(
    resetPreview.getByText('后台任务', { exact: true }).locator('..')
  ).toContainText('1 项');
  await expect(resetPreview.getByText(/合计 2 项/)).toBeVisible();
  await previewScope('model-configuration');
  await expect(
    resetPreview.getByText('模型档案与任务分配', { exact: true }).locator('..')
  ).toContainText('2 项');

  await reset.getByLabel('重置范围').selectOption('all-siftmark-data');
  await reset.getByRole('button', { name: '预览影响' }).click();
  await expect(reset.getByRole('button', { name: '先导出备份' })).toBeVisible();
  await expect(
    resetPreview.getByText('收藏 Agent 会话', { exact: true }).locator('..')
  ).toContainText('3 项');
  await expect(
    resetPreview.getByText('Agent 收藏偏好', { exact: true }).locator('..')
  ).toContainText('1 项');
  await expect(resetPreview.getByText(/合计 13 项/)).toBeVisible();
  await expect(reset.getByRole('button', { name: '执行重置' })).toBeDisabled();
  await reset.getByLabel('确认短语').fill('重置 Siftmark ');
  await expect(reset.getByRole('button', { name: '执行重置' })).toBeDisabled();
  await reset.getByLabel('确认短语').fill('重置 Siftmark');
  await Promise.all([
    options.waitForNavigation({ waitUntil: 'load' }),
    reset.getByRole('button', { name: '执行重置' }).click()
  ]);

  await expect(
    options.getByRole('heading', { name: '设置', exact: true })
  ).toBeVisible();
  expect(await options.evaluate(() => chrome.bookmarks.getTree())).toEqual(
    before
  );
  expect(
    await options.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)).filter((key) =>
        key.startsWith('siftmark.')
      )
    )
  ).toEqual([]);
  for (const store of [
    'bookmarkMetadata',
    'thumbnails',
    'operationLog',
    'tasks',
    'searchIndex',
    'captureSessions',
    'capturePreferences'
  ]) {
    expect(await readDatabaseStore(options, store)).toEqual([]);
  }
});
