import { expect, restartExtensionWorker, test } from './fixtures/extension';
import { putDatabaseRecord } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('restores the five-minute sleep-review alarm when enabled', async ({
  context,
  extensionId
}) => {
  const options = await openExtensionPage(
    context,
    extensionId,
    'options.html'
  );
  await options.evaluate(async () => {
    await chrome.storage.local.set({
      'siftmark.settings.sleep-review.v1': {
        enabled: true,
        idleMinutes: 15,
        batchSize: 8
      }
    });
  });

  await expect
    .poll(() =>
      options.evaluate(async () => {
        const alarm = await chrome.alarms.get('siftmark-sleep-review');
        return alarm?.periodInMinutes;
      })
    )
    .toBe(5);

  await restartExtensionWorker(context, options, extensionId);
  await expect
    .poll(() =>
      options.evaluate(async () => {
        const alarm = await chrome.alarms.get('siftmark-sleep-review');
        return alarm?.periodInMinutes;
      })
    )
    .toBe(5);
});

test('shows a complete local Agent record without layout overflow', async ({
  context,
  extensionId
}) => {
  const options = await openExtensionPage(
    context,
    extensionId,
    'options.html'
  );
  const timestamp = Date.now();
  const payload = {
    id: 'agent-history-e2e',
    bookmarkId: 'history-bookmark',
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: 'history-bookmark',
      parentId: '1',
      index: 0,
      title: 'Agent 历史验收网页',
      url: 'https://history.siftmark.test/article'
    },
    state: 'applied',
    resolution: 'allowed',
    resolvedAt: timestamp,
    plan: {
      destination: {
        folderId: 'ai',
        path: [
          { id: 'dev', title: '开发' },
          { id: 'ai', title: 'AI' }
        ],
        newFolders: ['Agent']
      },
      title: 'Agent 历史验收记录',
      tags: ['Agent'],
      summary: '设置页完整记录验收。',
      confidence: 'high',
      reason: '内容与 Agent 开发相关。',
      relatedBookmarks: [],
      generatedAt: timestamp
    },
    messages: [
      {
        id: 'history-user',
        role: 'user',
        text: '保留对话并放到开发目录。',
        createdAt: timestamp - 2
      },
      {
        id: 'history-assistant',
        role: 'assistant',
        text: '已按要求调整，并保留本次分析记录。',
        createdAt: timestamp - 1
      }
    ],
    activities: [
      {
        id: 'vision',
        kind: 'vision',
        status: 'completed',
        label: '模型服务已确认图片输入',
        detail: '截图仅用于本次归类。',
        facts: [{ label: '服务确认', value: '图片输入已接受' }],
        createdAt: timestamp - 5,
        updatedAt: timestamp - 4
      },
      {
        id: 'web-search',
        kind: 'web-search',
        status: 'completed',
        label: '联网搜索已完成',
        detail: '返回标准搜索调用记录。',
        createdAt: timestamp - 3,
        updatedAt: timestamp - 2
      }
    ],
    createdAt: timestamp - 10,
    updatedAt: timestamp,
    expiresAt: timestamp + 60_000
  };
  await putDatabaseRecord(options, 'captureSessions', {
    id: payload.id,
    bookmarkId: payload.bookmarkId,
    state: payload.state,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    expiresAt: payload.expiresAt,
    payload
  });

  await options.goto(`chrome-extension://${extensionId}/options.html#agent`);
  const record = options.locator('.agent-record').filter({
    hasText: 'Agent 历史验收记录'
  });
  await expect(record).toBeVisible();
  await record.locator('summary').click();
  await expect(record.getByText('保留对话并放到开发目录。')).toBeVisible();
  await expect(record.getByText('模型服务已确认图片输入')).toBeVisible();
  await expect(record.getByText('联网搜索已完成')).toBeVisible();
  await expect(record.getByRole('button', { name: '删除记录' })).toBeVisible();
  expect(
    await options.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  ).toBe(true);

  await options.setViewportSize({ width: 390, height: 844 });
  await expect(record).toBeVisible();
  expect(
    await options.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  ).toBe(true);
});
