import { describe, expect, it, vi } from 'vitest';
import { AiAdapterRegistry } from '../../../src/ai/adapter-registry';
import type {
  AiOrganizationContext,
  AiOrganizationResult,
  OrganizationBookmarkInput
} from '../../../src/ai/organization-types';
import {
  buildOrganizationPrompt,
  organizationBookmarkData
} from '../../../src/ai/prompts/organization-prompt';
import { parseOrganizationText } from '../../../src/ai/schemas/organization-parser';
import { ORGANIZATION_LIMITS } from '../../../src/ai/schemas/organization-contract';
import type { ModelProfile } from '../../../src/ai/types';
import {
  BookmarkOrganizationPlanner,
  splitOrganizationBookmarks
} from '../../../src/bookmarks/organization-planner';

const profile: ModelProfile = {
  id: 'p',
  version: '1',
  name: 'Model',
  protocol: 'openai-chat',
  endpoint: 'https://api.test',
  model: 'model',
  apiKey: '',
  timeoutMs: 1000,
  capabilities: ['classify'],
  state: 'verified'
};
const folders = [{ path: ['开发', '参考文档'], purpose: '参考资料' }];
const catalog = (count: number): OrganizationBookmarkInput[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `b${index}`,
    title: `Book ${index}`,
    url: `https://site.test/${index}`,
    currentFolderPath: ['旧错误目录']
  }));
function fixture() {
  const registry = new AiAdapterRegistry();
  const request = vi.fn(
    async (
      _profile: ModelProfile,
      context: AiOrganizationContext
    ): Promise<AiOrganizationResult> => ({
      folders: context.mode === 'assign' ? [] : folders,
      assignments:
        context.mode === 'assign'
          ? context.bookmarks.map((bookmark) => ({
              bookmarkId: bookmark.id,
              folderPath: folders[0]!.path,
              confidence: 'high',
              reason: '参考文档',
              summary: '文档'
            }))
          : []
    })
  );
  registry.register({
    protocol: 'openai-chat',
    testConnection: vi.fn(),
    analyze: vi.fn(),
    planOrganization: request
  });
  return { request, planner: new BookmarkOrganizationPlanner(registry) };
}

describe('global organization planner', () => {
  it.each([1, 2, 4])(
    'bounds both independent phases to concurrency %i and reports completed batch summaries',
    async (concurrency) => {
      const { planner, request } = fixture();
      const normal = request.getMockImplementation()!;
      let active = 0;
      let peak = 0;
      request.mockImplementation(async (profile, context) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await normal(profile, context);
        active -= 1;
        return result;
      });
      const report = vi.fn();
      const result = await planner.plan(catalog(321), profile, report, {
        concurrency
      });
      expect(peak).toBe(concurrency);
      expect(result.assignments).toHaveLength(321);
      const requests = report.mock.calls.at(-1)![0].batches;
      expect(requests).toHaveLength(11);
      expect(
        requests.every(
          (request: { status: string; summary?: string }) =>
            request.status === 'completed' && request.summary
        )
      ).toBe(true);
      expect(
        request.mock.calls
          .filter(([, context]) => context.mode === 'taxonomy')
          .every(([, context]) => !context.suggestedFolders)
      ).toBe(true);
    }
  );

  it('reads every batch, finalizes one global tree, then assigns every bookmark with the same profile', async () => {
    const { planner, request } = fixture();
    const input = catalog(161);
    const report = vi.fn();
    const result = await planner.plan(input, profile, report);
    expect(request.mock.calls.map(([, context]) => context.mode)).toEqual([
      'taxonomy',
      'taxonomy',
      'taxonomy',
      'merge-taxonomy',
      'assign',
      'assign',
      'assign'
    ]);
    expect(
      request.mock.calls
        .filter(([, context]) => context.mode === 'taxonomy')
        .flatMap(([, context]) =>
          context.bookmarks.map((bookmark) => bookmark.id)
        )
    ).toEqual(input.map((bookmark) => bookmark.id));
    const requestProfile = request.mock.calls[0]![0];
    expect(requestProfile).toEqual({ ...profile, timeoutMs: 360_000 });
    expect(requestProfile).not.toBe(profile);
    expect(
      request.mock.calls
        .filter(([, context]) => context.mode !== 'merge-taxonomy')
        .every(([selected]) => selected === requestProfile)
    ).toBe(true);
    expect(
      request.mock.calls
        .filter(([, context]) => context.mode === 'merge-taxonomy')
        .every(([selected]) => selected.timeoutMs === 360_000)
    ).toBe(true);
    expect(profile.timeoutMs).toBe(1000);
    const assignCalls = request.mock.calls.filter(
      ([, context]) => context.mode === 'assign'
    );
    expect(
      assignCalls.every(
        ([, context]) => context.taxonomy === assignCalls[0]![1].taxonomy
      )
    ).toBe(true);
    expect(result.assignments).toHaveLength(161);
    expect(
      new Set(result.assignments.map((entry) => entry.bookmarkId)).size
    ).toBe(161);
    expect(report.mock.calls.at(-1)![0]).toMatchObject({
      read: 161,
      assigned: 161,
      stage: 'assigning'
    });
  });

  it.each([
    [30_000, 360_000],
    [420_000, 420_000]
  ])(
    'gives bulk requests enough time while preserving a %i ms model configuration',
    async (configuredTimeout, requestTimeout) => {
      const { planner, request } = fixture();
      const selected = { ...profile, timeoutMs: configuredTimeout };
      await planner.plan(catalog(1), selected, vi.fn());
      expect(request).toHaveBeenCalledTimes(3);
      expect(
        request.mock.calls.every(
          ([used, context]) =>
            used.timeoutMs ===
            (context.mode === 'merge-taxonomy'
              ? Math.max(requestTimeout, 360_000)
              : requestTimeout)
        )
      ).toBe(true);
      expect(selected.timeoutMs).toBe(configuredTimeout);
      expect(request.mock.calls[0]![0]).toMatchObject({
        id: selected.id,
        version: selected.version,
        endpoint: selected.endpoint,
        model: selected.model
      });
    }
  );

  it('bounds batches by actual sanitized UTF-8 input bytes as well as item count', () => {
    const input = catalog(80).map((bookmark) => ({
      ...bookmark,
      title: '中文'.repeat(100),
      url: `https://site.test/${'a'.repeat(900)}`
    }));
    const batches = splitOrganizationBookmarks(input);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(input);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(
        ORGANIZATION_LIMITS.bookmarksPerRequest
      );
      expect(
        new TextEncoder().encode(
          JSON.stringify(organizationBookmarkData(batch))
        ).length
      ).toBeLessThanOrEqual(ORGANIZATION_LIMITS.requestDataBytes);
    }
  });

  it('omits old folder paths, redacts credentials, and gives semantic rather than domain-based instructions', () => {
    const context: AiOrganizationContext = {
      mode: 'taxonomy',
      bookmarks: [
        {
          id: 'a',
          title: 'password=secret',
          url: 'https://user:pass@a.test/path?token=secret#auth',
          currentFolderPath: ['旧错误目录']
        }
      ]
    };
    const prompt = buildOrganizationPrompt(context);
    expect(prompt.user).not.toContain('旧错误目录');
    expect(prompt.user).not.toContain('token=');
    expect(prompt.user).not.toContain('user:pass');
    expect(prompt.user).not.toContain('password=secret');
    expect(prompt.system).toContain('同义主题要合并');
    expect(prompt.system).toContain('不要强制每条路径都填满三层');
    expect(prompt.user).toContain('https://a.test/path');
  });

  it('treats merge input as the already-read taxonomy rather than an empty bookmark library', () => {
    const prompt = buildOrganizationPrompt({
      mode: 'merge-taxonomy',
      bookmarks: [],
      suggestedFolders: folders
    });
    expect(prompt.user).toContain(JSON.stringify(folders));
    expect(prompt.user).not.toContain('书签数据：[]');
    expect(prompt.user).toContain('保留全部已发现的主题');
  });

  it('still rejects an empty merged tree before assigning any bookmarks', async () => {
    const { planner, request } = fixture();
    request.mockResolvedValueOnce({ folders, assignments: [] });
    request.mockResolvedValueOnce({ folders: [], assignments: [] });
    await expect(planner.plan(catalog(1), profile, vi.fn())).rejects.toThrow(
      '未规划任何分类目录'
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not advance to assignment on a malformed global tree', async () => {
    const { planner, request } = fixture();
    request.mockResolvedValueOnce({ folders, assignments: [] });
    request.mockResolvedValueOnce({
      folders: [
        { path: ['开发'], purpose: '' },
        { path: ['开发'], purpose: '' }
      ],
      assignments: []
    });
    await expect(planner.plan(catalog(1), profile, vi.fn())).rejects.toThrow(
      '重复目录'
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects omissions instead of assigning a fallback old folder', async () => {
    const { planner, request } = fixture();
    request.mockImplementation(async (_profile, context) => ({
      folders: context.mode === 'assign' ? [] : folders,
      assignments: []
    }));
    await expect(planner.plan(catalog(1), profile, vi.fn())).rejects.toThrow(
      '全部书签分配目录'
    );
  });

  it('rejects taxonomy changes during assignment', async () => {
    const { planner, request } = fixture();
    request.mockImplementation(async (_profile, context) => ({
      folders,
      assignments:
        context.mode === 'assign'
          ? [
              {
                bookmarkId: 'b0',
                folderPath: folders[0]!.path,
                confidence: 'high',
                summary: '',
                reason: ''
              }
            ]
          : []
    }));
    await expect(planner.plan(catalog(1), profile, vi.fn())).rejects.toThrow(
      '不得修改全局目录树'
    );
  });

  it('requires a verified classify-capable profile', async () => {
    const { planner, request } = fixture();
    await expect(
      planner.plan(catalog(1), { ...profile, state: 'draft' }, vi.fn())
    ).rejects.toThrow('不可用');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('organization response trust boundary', () => {
  it('rejects extra fields, a fourth level, separators, and conflicting path spellings', async () => {
    expect(() =>
      parseOrganizationText(
        JSON.stringify({ folders, assignments: [], extra: true })
      )
    ).toThrow();
    expect(() =>
      parseOrganizationText(
        JSON.stringify({
          folders: [{ path: ['a', 'b', 'c', 'd'], purpose: '' }],
          assignments: []
        })
      )
    ).toThrow();
    expect(() =>
      parseOrganizationText(
        JSON.stringify({
          folders: [{ path: ['a/b'], purpose: '' }],
          assignments: []
        })
      )
    ).toThrow();
    const { planner, request } = fixture();
    request.mockResolvedValue({
      folders: [
        { path: ['Dev', 'a'], purpose: '' },
        { path: ['dev', 'b'], purpose: '' }
      ],
      assignments: []
    });
    await expect(planner.plan(catalog(1), profile, vi.fn())).rejects.toThrow(
      '字符冲突'
    );
  });

  it.each(['taxonomy', 'merge-taxonomy'] as const)(
    'fills only the omitted empty assignments array in %s',
    (mode) => {
      expect(parseOrganizationText(JSON.stringify({ folders }), mode)).toEqual({
        folders,
        assignments: []
      });
      expect(() =>
        parseOrganizationText(JSON.stringify({ folders, extra: true }), mode)
      ).toThrow('结构');
      expect(() =>
        parseOrganizationText(
          JSON.stringify({ folders, assignments: null }),
          mode
        )
      ).toThrow('结构');
      expect(() =>
        parseOrganizationText(
          JSON.stringify({ folders: [{ path: ['开发'] }] }),
          mode
        )
      ).toThrow('结构');
      expect(() => parseOrganizationText('null', mode)).toThrow('结构');
      expect(() => parseOrganizationText('[]', mode)).toThrow('结构');
    }
  );

  it('never fills missing assignments during assignment or without an explicit planning mode', () => {
    const response = JSON.stringify({ folders });
    expect(() => parseOrganizationText(response, 'assign')).toThrow('结构');
    expect(() => parseOrganizationText(response)).toThrow('结构');
  });

  it('accepts fenced JSON but not arbitrary surrounding model text', () => {
    expect(
      parseOrganizationText(
        `\`\`\`json\n${JSON.stringify({ folders, assignments: [] })}\n\`\`\``
      )
    ).toEqual({ folders, assignments: [] });
    expect(() => parseOrganizationText('Here is my plan')).toThrow('有效 JSON');
  });
  it('retries one malformed taxonomy batch instead of stopping the whole plan', async () => {
    const { planner, request } = fixture();
    const normal = request.getMockImplementation()!;
    let taxonomyAttempts = 0;
    request.mockImplementation(async (selected, context) => {
      if (context.mode === 'taxonomy' && taxonomyAttempts++ === 0)
        throw new Error('AI 全量规划结果不符合目录和归属结构');
      return normal(selected, context);
    });
    const report = vi.fn();
    const result = await planner.plan(catalog(1), profile, report, {
      concurrency: 1
    });
    expect(result.assignments).toHaveLength(1);
    expect(taxonomyAttempts).toBe(2);
    expect(report.mock.calls.at(-1)![0].batches[0]).toMatchObject({
      status: 'completed',
      attempt: 2
    });
  });
  it('gives reading and merging six minutes when the profile timeout is shorter', async () => {
    const { planner, request } = fixture();
    await planner.plan(catalog(1), profile, vi.fn(), { concurrency: 1 });
    const taxonomy = request.mock.calls.find(
      (call) => call[1].mode === 'taxonomy'
    );
    const merge = request.mock.calls.find(
      (call) => call[1].mode === 'merge-taxonomy'
    );
    expect(taxonomy?.[0].timeoutMs).toBe(360_000);
    expect(merge?.[0].timeoutMs).toBe(360_000);
  });
  it('keeps a usable tree when model merges stop shrinking', async () => {
    const registry = new AiAdapterRegistry();
    const request = vi.fn(
      async (
        _profile: ModelProfile,
        context: AiOrganizationContext
      ): Promise<AiOrganizationResult> => {
        if (context.mode === 'taxonomy') {
          return {
            folders: context.bookmarks.map((bookmark, index) => ({
              path: [index < 80 ? '开发' : '设计', bookmark.title],
              purpose: '资料'
            })),
            assignments: []
          };
        }
        if (context.mode === 'merge-taxonomy') {
          return { folders: context.suggestedFolders ?? [], assignments: [] };
        }
        return {
          folders: [],
          assignments: context.bookmarks.map((bookmark) => ({
            bookmarkId: bookmark.id,
            folderPath: context.taxonomy?.[0]?.path ?? ['开发'],
            confidence: 'high',
            reason: '同一主题',
            summary: '资料'
          }))
        };
      }
    );
    registry.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze: vi.fn(),
      planOrganization: request
    });
    const planner = new BookmarkOrganizationPlanner(registry);
    const result = await planner.plan(catalog(100), profile, vi.fn());
    expect(result.folders.length).toBeLessThanOrEqual(80);
    expect(result.assignments).toHaveLength(100);
    expect(result.folders.some((folder) => folder.path.length > 2)).toBe(false);
  });
  it('reuses legacy reading themes but revalidates assignments without an input key', async () => {
    const { planner, request } = fixture();
    const bookmarks = catalog(81);
    const assignment = (bookmark: (typeof bookmarks)[number]) => ({
      bookmarkId: bookmark.id,
      folderPath: folders[0]!.path,
      confidence: 'high' as const,
      reason: '参考文档',
      summary: '文档'
    });
    await planner.plan(bookmarks, profile, vi.fn(), {
      concurrency: 1,
      resumeBatches: [
        {
          id: 'reading-1',
          stage: 'reading',
          batch: 1,
          count: 80,
          status: 'completed',
          attempt: 1,
          folders
        },
        {
          id: 'reading-2',
          stage: 'reading',
          batch: 2,
          count: 1,
          status: 'failed',
          attempt: 3,
          error: '模型请求超时'
        },
        {
          id: 'assigning-1',
          stage: 'assigning',
          batch: 1,
          count: 80,
          status: 'completed',
          attempt: 1,
          assignments: bookmarks.slice(0, 80).map(assignment)
        }
      ]
    });
    const taxonomy = request.mock.calls.filter(
      (call) => call[1].mode === 'taxonomy'
    );
    const assign = request.mock.calls.filter(
      (call) => call[1].mode === 'assign'
    );
    expect(taxonomy).toHaveLength(1);
    expect(taxonomy[0]![1].bookmarks).toHaveLength(1);
    expect(assign).toHaveLength(2);
    expect(assign.flatMap(([, context]) => context.bookmarks)).toEqual(
      bookmarks
    );
  });

  it('skips reading when the saved folder list covers every completed reading batch', async () => {
    const { planner, request } = fixture();
    await planner.plan(catalog(81), profile, vi.fn(), {
      concurrency: 1,
      resumeFolders: folders,
      resumeBatches: [1, 2].map((batch) => ({
        id: `reading-${batch}`,
        stage: 'reading' as const,
        batch,
        count: batch === 1 ? 80 : 1,
        status: 'completed' as const,
        attempt: 1,
        summary: '已完成'
      }))
    });
    expect(
      request.mock.calls.filter((call) => call[1].mode === 'taxonomy')
    ).toHaveLength(0);
  });
});
