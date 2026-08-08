import { expect, test } from './fixtures/extension';
import { putDatabaseRecord, readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('resumes onboarding, performs a read-only scan, and resets without deleting native bookmarks', async ({
  context,
  extensionId
}) => {
  await context.addInitScript(() => {
    let notificationsGranted = false;
    const originalContains = chrome.permissions.contains.bind(
      chrome.permissions
    );
    Object.defineProperty(chrome.permissions, 'contains', {
      configurable: true,
      value: (permissions: chrome.permissions.Permissions) =>
        permissions.permissions?.includes('notifications')
          ? Promise.resolve(notificationsGranted)
          : originalContains(permissions)
    });
    Object.defineProperty(chrome.permissions, 'request', {
      configurable: true,
      value: (permissions: chrome.permissions.Permissions) => {
        if (permissions.permissions?.includes('notifications')) {
          notificationsGranted = true;
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      }
    });
  });
  const options = await openExtensionPage(context, extensionId, 'options.html');
  await expect(
    options.getByRole('heading', { name: '权限与隐私' })
  ).toBeVisible();
  await expect(options.getByText('可选，默认关闭')).toBeVisible();
  expect(
    await options.evaluate(() =>
      chrome.permissions.contains({ permissions: ['notifications'] })
    )
  ).toBe(false);
  await options.getByRole('button', { name: '授权任务通知' }).click();
  await expect(options.getByText('后台通知').locator('..')).toContainText(
    '已授权'
  );
  expect(
    await options.evaluate(() =>
      chrome.permissions.contains({ permissions: ['notifications'] })
    )
  ).toBe(true);
  await options.getByRole('button', { name: '完成并继续' }).click();

  const inboxRow = options
    .locator('.special-folder-row')
    .filter({ hasText: '待整理箱' });
  await inboxRow.getByRole('button', { name: '创建并绑定' }).click();
  await expect(inboxRow.getByText('绑定正常')).toBeVisible();
  const specialFolders = await options.evaluate(async () => {
    const stored = await chrome.storage.local.get(
      'siftmark.settings.special-folders.v1'
    );
    return stored['siftmark.settings.special-folders.v1'] as {
      inboxId?: string;
    };
  });
  expect(specialFolders.inboxId).toBeTruthy();
  await expect
    .poll(() =>
      options.evaluate(
        async (id) => (await chrome.bookmarks.get(id!))[0]?.title,
        specialFolders.inboxId
      )
    )
    .toBe('Siftmark 待整理');
  await options.getByRole('button', { name: '完成并继续' }).click();
  await options.reload();
  await expect(
    options.getByRole('heading', { name: '网页悬浮按钮' })
  ).toBeVisible();
  await options.getByRole('button', { name: '跳过此步' }).click();
  await expect(
    options.getByRole('heading', { name: '可选模型' })
  ).toBeVisible();
  await expect(options.getByText(/模型配置可选；未配置时/)).toBeVisible();
  expect(
    await options.evaluate(async () => {
      const stored = await chrome.storage.local.get([
        'siftmark.ai.profiles.v1',
        'siftmark.settings.profile-assignments.v1'
      ]);
      return Object.keys(stored);
    })
  ).toEqual([]);
  await options.getByRole('button', { name: '跳过此步' }).click();
  await options.getByRole('button', { name: '跳过此步' }).click();

  const scanFixture = await options.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0]?.children?.find((node) => !node.url) ?? tree[0];
    if (!root) throw new Error('Missing native bookmark root');
    const folder = await chrome.bookmarks.create({
      parentId: root.id,
      title: '只读扫描样本'
    });
    const first = await chrome.bookmarks.create({
      parentId: folder.id,
      title: '重置后保留',
      url: 'https://duplicate.siftmark.test/path?utm_source=onboarding'
    });
    const duplicate = await chrome.bookmarks.create({
      parentId: folder.id,
      title: '重复网址',
      url: 'https://duplicate.siftmark.test/path'
    });
    const lowConfidence = await chrome.bookmarks.create({
      parentId: folder.id,
      title: '待整理书签',
      url: 'https://triage.siftmark.test/'
    });
    return {
      nativeId: first.id,
      duplicateId: duplicate.id,
      lowConfidenceId: lowConfidence.id
    };
  });
  await putDatabaseRecord(options, 'bookmarkMetadata', {
    bookmarkId: scanFixture.nativeId,
    summary: '已检查',
    tags: [],
    note: '',
    confidence: 'high',
    reason: '',
    health: 'healthy',
    updatedAt: 1
  });
  await putDatabaseRecord(options, 'bookmarkMetadata', {
    bookmarkId: scanFixture.lowConfidenceId,
    summary: '低置信度',
    tags: [],
    note: '',
    confidence: 'low',
    reason: '',
    health: 'dead',
    updatedAt: 1
  });
  const before = await options.evaluate(() => chrome.bookmarks.getTree());
  await options.getByRole('button', { name: '扫描现有书签' }).click();
  const scanResult = options.locator('.onboarding-scan-result');
  await expect(scanResult).toContainText('3 个书签');
  await expect(scanResult).toContainText('1 组重复网址，涉及 2 个书签');
  await expect(scanResult).toContainText('2 个已检查，1 个未检查');
  await expect(scanResult).toContainText('2 个书签待整理');
  const after = await options.evaluate(() => chrome.bookmarks.getTree());
  expect(after).toEqual(before);
  await options.getByRole('button', { name: '完成引导' }).click();
  await expect(options.getByRole('heading', { name: '设置' })).toBeVisible();
  expect(
    await options.evaluate(async () => {
      const stored = await chrome.storage.local.get('siftmark.onboarding.v1');
      return stored['siftmark.onboarding.v1'];
    })
  ).toMatchObject({
    status: 'completed',
    currentStep: null,
    completedSteps: [
      'permissions-privacy',
      'special-folders',
      'read-only-scan'
    ],
    skippedSteps: ['floating-button', 'model', 'migration']
  });

  await putDatabaseRecord(options, 'bookmarkMetadata', {
    bookmarkId: scanFixture.nativeId,
    summary: '将被重置',
    tags: [],
    note: '',
    confidence: 'unknown',
    reason: '',
    health: 'unchecked',
    updatedAt: Date.now()
  });
  await putDatabaseRecord(options, 'thumbnails', {
    bookmarkId: scanFixture.nativeId,
    blob: { size: 3 },
    state: 'ready',
    createdAt: 1,
    lastAccessedAt: 1
  });
  await putDatabaseRecord(options, 'searchIndex', {
    id: `keyword:${scanFixture.nativeId}`,
    kind: 'keyword',
    bookmarkId: scanFixture.nativeId,
    keywordTokens: ['重置'],
    updatedAt: 1
  });
  await putDatabaseRecord(options, 'operationLog', {
    id: 'reset-operation',
    type: 'update',
    bookmarkId: scanFixture.nativeId,
    before: {},
    after: {},
    idempotencyKey: 'reset-operation-key',
    createdAt: 1
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
    createdAt: 1,
    updatedAt: 1
  });
  await options.evaluate(async () => {
    await chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [{ id: 'reset-profile' }],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'reset-profile@v1'
      }
    });
  });
  const reset = options.locator('section').filter({ hasText: '重置' }).last();

  const previewScope = async (scope: string) => {
    await reset.getByLabel('重置范围').selectOption(scope);
    await reset.getByRole('button', { name: '预览影响' }).click();
    await expect(reset.getByText('已生成重置预览')).toBeVisible();
  };
  await previewScope('cache-thumbnails');
  const resetPreview = reset.locator('.reset-preview');
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
  await expect(resetPreview.getByText(/合计 10 项/)).toBeVisible();
  await expect(reset.getByRole('button', { name: '执行重置' })).toBeDisabled();
  await reset.getByLabel('确认短语').fill('重置 Siftmark ');
  await expect(reset.getByRole('button', { name: '执行重置' })).toBeDisabled();
  await reset.getByLabel('确认短语').fill('重置 Siftmark');
  await reset.getByRole('button', { name: '执行重置' }).click();
  await expect(
    options.getByRole('heading', { name: '权限与隐私' })
  ).toBeVisible();
  await expect
    .poll(() =>
      options.evaluate(
        async (id) => (await chrome.bookmarks.get(id))[0]?.title,
        scanFixture.nativeId
      )
    )
    .toBe('重置后保留');
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
    'searchIndex'
  ]) {
    expect(await readDatabaseStore(options, store)).toEqual([]);
  }
});
