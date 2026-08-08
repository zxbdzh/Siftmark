import { expect, restartExtensionWorker, test } from './fixtures/extension';
import {
  createRootFolder,
  putDatabaseRecord,
  readDatabaseStore
} from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

test('requires secondary confirmation for more than twenty tabs and recovers durable work', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  await resetProvider();
  await setProviderBehavior({ failAnalysisCount: 1 });
  const manager = await openExtensionPage(context, extensionId, 'manager.html');
  await configureClassifier(manager);
  const folderId = await createRootFolder(manager, '批量保存目标');
  for (let index = 0; index < 21; index += 1) {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4173/article?batch=${index}`);
  }
  const popup = await openExtensionPage(context, extensionId, 'popup.html');
  await popup.getByLabel('保存到').selectOption(folderId);
  await popup.getByText('批量保存标签页').click();
  await popup.getByRole('button', { name: '全选 21 项' }).click();
  await popup.getByRole('button', { name: '保存所选 21 项' }).click();
  const confirmation = popup.getByRole('alert');
  await expect(confirmation).toContainText('将创建最多 21 个书签');
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(confirmation).toHaveCount(0);
  await popup.getByRole('button', { name: '保存所选 21 项' }).click();
  await popup
    .getByRole('alert')
    .getByRole('button', { name: '确认保存 21 项' })
    .click();
  await expect(popup.getByRole('status')).toHaveText('已处理 21 个标签页');
  await expect
    .poll(() =>
      manager.evaluate(
        async (parentId) =>
          (await chrome.bookmarks.getChildren(parentId)).filter((bookmark) =>
            bookmark.url?.includes('?batch=')
          ).length,
        folderId
      )
    )
    .toBe(21);
  await expect
    .poll(
      async () => {
        const proposals = await readDatabaseStore<{ state: string }>(
          manager,
          'analysisProposals'
        );
        const tasks = await readDatabaseStore<{ type: string; state: string }>(
          manager,
          'tasks'
        );
        return {
          pending: proposals.filter((proposal) => proposal.state === 'pending')
            .length,
          failed: proposals.filter((proposal) => proposal.state === 'failed')
            .length,
          tasks: tasks
            .filter((task) => task.type === 'analyze-bookmark')
            .reduce<Record<string, number>>((counts, task) => {
              counts[task.state] = (counts[task.state] ?? 0) + 1;
              return counts;
            }, {})
        };
      },
      { timeout: 20_000 }
    )
    .toEqual({ pending: 20, failed: 1, tasks: { succeeded: 21 } });

  await manager.reload();
  await manager.getByRole('tab', { name: '审核' }).click();
  await manager.getByRole('button', { name: '失败' }).click();
  await manager.getByRole('button', { name: '重新运行当前 1 项' }).click();
  await expect(manager.locator('.review-workspace output')).toHaveText(
    '已重新排队 1 个项目'
  );
  await expect
    .poll(
      async () => {
        const proposals = await readDatabaseStore<{ state: string }>(
          manager,
          'analysisProposals'
        );
        return proposals.filter((proposal) => proposal.state === 'pending')
          .length;
      },
      { timeout: 20_000 }
    )
    .toBe(21);
  const operations = await readDatabaseStore<{
    batchId?: string;
    type: string;
  }>(manager, 'operationLog');
  const batchIds = new Set(
    operations
      .filter((operation) => operation.type === 'create')
      .map((operation) => operation.batchId)
  );
  expect(batchIds.size).toBe(1);
  expect([...batchIds][0]).toBeTruthy();
  await popup.getByRole('button', { name: '撤销本次批量保存' }).click();
  await expect(popup.getByRole('status')).toHaveText(
    '已撤销 21 个，0 个未撤销'
  );
  await expect
    .poll(() =>
      manager.evaluate(
        async (parentId) =>
          (await chrome.bookmarks.getChildren(parentId)).filter((bookmark) =>
            bookmark.url?.includes('?batch=')
          ).length,
        folderId
      )
    )
    .toBe(0);

  const now = Date.now();
  await putDatabaseRecord(manager, 'tasks', {
    id: 'recover-after-restart',
    type: 'ai-request',
    state: 'running',
    input: {},
    completed: 7,
    failed: 1,
    retryCount: 0,
    idempotencyKey: 'restart-once',
    createdAt: now,
    updatedAt: now
  });
  await restartExtensionWorker(context, manager, extensionId);
  await expect
    .poll(async () => {
      const rows = await readDatabaseStore<{
        id: string;
        state: string;
        idempotencyKey: string;
      }>(manager, 'tasks');
      return rows.find((row) => row.id === 'recover-after-restart')?.state;
    })
    .toBe('unknown');
  const rows = await readDatabaseStore<{ idempotencyKey: string }>(
    manager,
    'tasks'
  );
  expect(
    rows.filter((row) => row.idempotencyKey === 'restart-once')
  ).toHaveLength(1);
});

async function configureClassifier(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      'siftmark.ai.profiles.v1': [
        {
          id: 'e2e-batch-classifier',
          version: 'v1',
          name: '批量分类夹具',
          protocol: 'openai-chat',
          endpoint: 'http://127.0.0.1:4173/v1',
          model: 'fixture-model',
          apiKey: 'e2e-secret-key',
          timeoutMs: 10_000,
          capabilities: ['classify'],
          state: 'verified',
          verifiedAt: Date.now()
        }
      ],
      'siftmark.settings.profile-assignments.v1': {
        classify: 'e2e-batch-classifier@v1'
      }
    });
  });
}

async function resetProvider(): Promise<void> {
  const response = await fetch('http://127.0.0.1:4173/__e2e/reset', {
    method: 'POST'
  });
  expect(response.ok).toBe(true);
}

async function setProviderBehavior(behavior: {
  failAnalysisCount: number;
}): Promise<void> {
  const response = await fetch('http://127.0.0.1:4173/__e2e/behavior', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(behavior)
  });
  expect(response.ok).toBe(true);
}
