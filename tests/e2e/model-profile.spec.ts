import { expect, test } from './fixtures/extension';
import { readDatabaseStore } from './fixtures/chrome-state';
import { openExtensionPage } from './helpers/extension-pages';

interface RecordedProviderRequest {
  path: string;
  headerNames: string[];
  body: Record<string, unknown>;
}

const protocols = [
  {
    id: 'openai-chat',
    path: '/v1/chat/completions',
    headers: ['authorization'],
    bodyKeys: ['messages', 'response_format']
  },
  {
    id: 'openai-responses',
    path: '/v1/responses',
    headers: ['authorization'],
    bodyKeys: ['input', 'text']
  },
  {
    id: 'anthropic-messages',
    path: '/v1/messages',
    headers: ['anthropic-version', 'x-api-key'],
    bodyKeys: ['messages', 'system']
  },
  {
    id: 'gemini-generate-content',
    path: '/v1/models/fixture-model:generateContent',
    headers: ['x-goog-api-key'],
    bodyKeys: ['contents', 'generationConfig']
  }
] as const;

test('verifies all protocol shapes and rejects unsafe model output', async ({
  context,
  extensionId
}) => {
  test.setTimeout(60_000);
  await resetProvider();
  const options = await openExtensionPage(context, extensionId, 'options.html');
  const section = options.locator('#model-profiles');
  for (const protocol of protocols) {
    await section.getByRole('button', { name: '新建' }).click();
    await expect(section.getByLabel('API Key')).toHaveAttribute(
      'type',
      'password'
    );
    await resetProvider();
    await section.getByLabel('名称').fill(`本地夹具 ${protocol.id}`);
    await section.getByLabel('协议').selectOption(protocol.id);
    await section.getByLabel('Endpoint').fill('http://127.0.0.1:43173/v1');
    await section.getByLabel('模型', { exact: true }).fill('fixture-model');
    await section.getByLabel('API Key').fill('e2e-secret-key');
    await section.getByRole('button', { name: '保存草稿' }).click();
    await expect(section.locator('output')).toHaveText('草稿已保存，尚未验证');
    await expect(
      section
        .locator('.model-profile-list li')
        .filter({ hasText: `本地夹具 ${protocol.id}` })
    ).toContainText('Key 已配置');
    await expect(options.getByText('e2e-secret-key')).toHaveCount(0);
    await section.getByRole('button', { name: '验证并保存' }).click();
    await expect(section.locator('output')).toContainText('验证通过');

    const request = (await providerRequests())[0]!;
    expect(request.path).toBe(protocol.path);
    expect(request.headerNames).toEqual(
      expect.arrayContaining([...protocol.headers])
    );
    expect(Object.keys(request.body)).toEqual(
      expect.arrayContaining([...protocol.bodyKeys])
    );
    expect(JSON.stringify(request)).not.toContain('e2e-secret-key');
    if (protocol.id !== protocols.at(-1)!.id) {
      await section.getByRole('button', { name: '关闭模型编辑' }).click();
    }
  }
  await section.getByRole('button', { name: '设为所选任务默认' }).click();
  await expect(section.locator('output')).toHaveText(
    '已设为所选任务的默认模型'
  );

  await options.evaluate(async () => {
    const key = 'siftmark.settings.smart-bookmark.v1';
    const stored = (await chrome.storage.local.get(key))[key];
    const current =
      stored && typeof stored === 'object'
        ? (stored as Record<string, unknown>)
        : {};
    await chrome.storage.local.set({
      [key]: { ...current, captureNativeBookmarks: false }
    });
  });
  const bookmarkId = await options.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const root = tree[0]?.children?.find((node) => !node.url) ?? tree[0];
    if (!root) throw new Error('Missing native bookmark root');
    return (
      await chrome.bookmarks.create({
        parentId: root.id,
        title: '无效 Schema 书签',
        url: 'http://127.0.0.1:43173/article'
      })
    ).id;
  });
  await setProviderBehavior({ invalidAnalysisCount: 1 });
  await options.evaluate(
    (id) =>
      chrome.runtime.sendMessage({
        type: 'queue-analysis',
        input: { bookmarkId: id }
      }),
    bookmarkId
  );
  await expect
    .poll(async () => {
      const proposals = await readDatabaseStore<{
        bookmarkId: string;
        state: string;
      }>(options, 'analysisProposals');
      return proposals.find((proposal) => proposal.bookmarkId === bookmarkId)
        ?.state;
    })
    .toBe('failed');

  const usageLogs = await options.evaluate(async () => {
    const request = indexedDB.open('siftmark');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('aiUsageLog', 'readonly');
    const getAll = transaction.objectStore('aiUsageLog').getAll();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
    database.close();
    return rows;
  });
  expect(JSON.stringify(usageLogs)).not.toContain('e2e-secret-key');
  const databaseText = await options.evaluate(async () => {
    const request = indexedDB.open('siftmark');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows: unknown[] = [];
    for (const storeName of Array.from(database.objectStoreNames)) {
      const transaction = database.transaction(storeName, 'readonly');
      const getAll = transaction.objectStore(storeName).getAll();
      rows.push(
        ...(await new Promise<unknown[]>((resolve, reject) => {
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        }))
      );
    }
    database.close();
    return JSON.stringify(rows);
  });
  expect(databaseText).not.toContain('这是用于端到端测试的确定性正文。');
  expect(databaseText).not.toContain('e2e-secret-key');
});

async function resetProvider(): Promise<void> {
  const response = await fetch('http://127.0.0.1:43173/__e2e/reset', {
    method: 'POST'
  });
  expect(response.ok).toBe(true);
}

async function setProviderBehavior(
  behavior: Partial<{
    delayAnalysisMs: number;
    failAnalysisCount: number;
    invalidAnalysisCount: number;
  }>
): Promise<void> {
  const response = await fetch('http://127.0.0.1:43173/__e2e/behavior', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(behavior)
  });
  expect(response.ok).toBe(true);
}

async function providerRequests(): Promise<RecordedProviderRequest[]> {
  const response = await fetch('http://127.0.0.1:43173/__e2e/requests');
  expect(response.ok).toBe(true);
  return response.json() as Promise<RecordedProviderRequest[]>;
}
