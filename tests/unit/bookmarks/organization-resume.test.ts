import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAdapterRegistry } from '../../../src/ai/adapter-registry';
import type { AiOrganizationContext } from '../../../src/ai/organization-types';
import type { ModelProfile } from '../../../src/ai/types';
import {
  BookmarkOrganizationPlanner,
  type OrganizationPlanningProgress
} from '../../../src/bookmarks/organization-planner';

const profile: ModelProfile = {
  id: 'resume',
  version: 'v1',
  name: 'Resume model',
  protocol: 'openai-chat',
  endpoint: 'https://model.test',
  model: 'model',
  apiKey: '',
  timeoutMs: 30000,
  capabilities: ['classify'],
  state: 'verified'
};
const bookmarks = () =>
  Array.from({ length: 81 }, (_, index) => ({
    id: `b${index}`,
    title: `Entry ${index}`,
    url: `https://test.example/${index}`,
    currentFolderPath: ['原目录']
  }));
function fixture() {
  const request = vi.fn(
    async (_profile: ModelProfile, context: AiOrganizationContext) => ({
      folders:
        context.mode === 'assign' ? [] : [{ path: ['开发'], purpose: '资料' }],
      assignments:
        context.mode === 'assign'
          ? context.bookmarks.map((bookmark) => ({
              bookmarkId: bookmark.id,
              folderPath: context.taxonomy![0]!.path,
              confidence: 'high' as const,
              summary: '资料',
              reason: '主要用途'
            }))
          : [],
      ...(context.mode === 'assign' ? { similarities: [] } : {})
    })
  );
  const registry = new AiAdapterRegistry();
  registry.register({
    protocol: 'openai-chat',
    testConnection: vi.fn(),
    analyze: vi.fn(),
    planOrganization: request
  });
  const planner = new BookmarkOrganizationPlanner(registry);
  let last!: OrganizationPlanningProgress;
  const report = (update: OrganizationPlanningProgress) => {
    last = structuredClone(update);
  };
  const saved = () => ({
    resumeBatches: last.batches,
    resumeFolders: last.folders
  });
  return { planner, request, report, saved };
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('organization batch recovery', () => {
  it('merges every independent topic proposal into one global tree even when 41–80 paths remain', async () => {
    const { planner, request, report } = fixture();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (selected, context) => {
      if (context.mode === 'taxonomy') {
        return {
          folders: Array.from({ length: 50 }, (_, index) => ({
            path: ['开发', `分类${index}`],
            purpose: '资料'
          })),
          assignments: []
        };
      }
      return normal(selected, context);
    });
    await planner.plan(bookmarks(), profile, report, { concurrency: 1 });
    const merges = request.mock.calls.filter(
      ([, context]) => context.mode === 'merge-taxonomy'
    );
    expect(merges).toHaveLength(1);
    expect(merges[0]![1].suggestedFolders).toHaveLength(50);
  });

  it('keeps successful reading, final merge, and assignments when only the last assignment failed', async () => {
    const { planner, request, report, saved } = fixture();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (selected, context) => {
      if (context.mode === 'assign' && context.bookmarks[0]!.id === 'b80')
        throw new Error('失败批次');
      return normal(selected, context);
    });
    await expect(
      planner.plan(bookmarks(), profile, report, { concurrency: 1 })
    ).rejects.toThrow('失败批次');
    const checkpoint = saved();
    request.mockClear();
    request.mockImplementation(normal);
    const result = await planner.plan(bookmarks(), profile, report, {
      ...checkpoint,
      concurrency: 1
    });
    expect(result.assignments).toHaveLength(81);
    expect(request.mock.calls.map(([, context]) => context.mode)).toEqual([
      'assign'
    ]);
    expect(request.mock.calls[0]![1].bookmarks[0]!.id).toBe('b80');
  });

  it('rechecks a changed title even when bookmark IDs and batch numbers are unchanged', async () => {
    const { planner, request, report, saved } = fixture();
    await planner.plan(bookmarks(), profile, report, { concurrency: 1 });
    const checkpoint = saved();
    const changed = bookmarks();
    changed[0]!.title = '新的收藏用途';
    request.mockClear();
    await planner.plan(changed, profile, report, {
      ...checkpoint,
      concurrency: 1
    });
    const readings = request.mock.calls.filter(
      ([, context]) => context.mode === 'taxonomy'
    );
    const assignments = request.mock.calls.filter(
      ([, context]) => context.mode === 'assign'
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]![1].bookmarks[0]!.title).toBe('新的收藏用途');
    expect(assignments).toHaveLength(1);
    expect(assignments[0]![1].bookmarks[0]!.id).toBe('b0');
  });

  it('validates persisted assignments before reusing them', async () => {
    const { planner, request, report, saved } = fixture();
    await planner.plan(bookmarks(), profile, report, { concurrency: 1 });
    const checkpoint = saved();
    const batch = checkpoint.resumeBatches!.find(
      (row) => row.stage === 'assigning' && row.batch === 1
    )!;
    batch.assignments![0]!.bookmarkId = 'unknown';
    request.mockClear();
    const result = await planner.plan(bookmarks(), profile, report, {
      ...checkpoint,
      concurrency: 1
    });
    expect(result.assignments).toHaveLength(81);
    expect(request.mock.calls.map(([, context]) => context.mode)).toEqual([
      'assign'
    ]);
    expect(request.mock.calls[0]![1].bookmarks[0]!.id).toBe('b0');
  });

  it('does not reuse an assignment from a different final taxonomy', async () => {
    const { planner, request, report, saved } = fixture();
    await planner.plan(bookmarks(), profile, report, { concurrency: 1 });
    const checkpoint = saved();
    for (const batch of checkpoint.resumeBatches!.filter(
      (row) => row.stage === 'planning'
    )) {
      batch.folders = [{ path: ['学习'], purpose: '资料' }];
    }
    request.mockClear();
    const result = await planner.plan(bookmarks(), profile, report, {
      ...checkpoint,
      concurrency: 1
    });
    expect(request.mock.calls.map(([, context]) => context.mode)).toEqual([
      'assign',
      'assign'
    ]);
    expect(
      result.assignments.every((row) => row.folderPath.join('/') === '学习')
    ).toBe(true);
  });
});
