import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAdapterRegistry } from '../../../src/ai/adapter-registry';
import type {
  AiOrganizationContext,
  OrganizationBookmarkInput
} from '../../../src/ai/organization-types';
import type { ModelProfile } from '../../../src/ai/types';
import {
  BookmarkOrganizationPlanner,
  type OrganizationPlanningProgress
} from '../../../src/bookmarks/organization-planner';
import { validateSimilarities } from '../../../src/bookmarks/organization-similarity';

const input: OrganizationBookmarkInput[] = [
  {
    id: 'a',
    title: '查询工具',
    url: 'https://tools.test/search?q=one',
    currentFolderPath: []
  },
  {
    id: 'b',
    title: '查询工具',
    url: 'https://tools.test/search?q=two',
    currentFolderPath: []
  },
  {
    id: 'c',
    title: '不同用途',
    url: 'https://other.test/',
    currentFolderPath: []
  }
];
const pair = (a: string, b: string) => ({
  bookmarkIds: [a, b] as [string, string],
  reason: '需要用户确认内容是否重叠',
  confidence: 'medium' as const
});
const profile: ModelProfile = {
  id: 'similarity',
  version: 'v1',
  name: 'Model',
  protocol: 'openai-chat',
  endpoint: 'https://model.test',
  model: 'model',
  apiKey: '',
  timeoutMs: 30000,
  capabilities: ['classify'],
  state: 'verified'
};

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('organization similarity trust boundary', () => {
  it('keeps only valid candidates and reports unknown, out-of-candidate, and duplicate suggestions', () => {
    const discarded = vi.fn();
    expect(
      validateSimilarities(
        [pair('a', 'b'), pair('a', 'unknown'), pair('a', 'c'), pair('b', 'a')],
        input,
        [['a', 'b']],
        discarded
      )
    ).toEqual([pair('a', 'b')]);
    expect(discarded).toHaveBeenCalledWith(3);
  });

  it('never records an exact-URL copy as similar and can safely reject every suggestion', () => {
    const discarded = vi.fn();
    const copies = [input[0]!, { ...input[0]!, id: 'copy' }];
    expect(
      validateSimilarities(
        [pair('a', 'copy'), pair('a', 'missing')],
        copies,
        undefined,
        discarded
      )
    ).toEqual([]);
    expect(discarded).toHaveBeenCalledWith(2);
  });

  it('continues to reject malformed suggestions and extra fields', () => {
    expect(() =>
      validateSimilarities([{ ...pair('a', 'b'), action: 'delete' }], input)
    ).toThrow();
    expect(() =>
      validateSimilarities([{ ...pair('a', 'b'), bookmarkIds: ['a'] }], input)
    ).toThrow();
  });

  it.each(['assign', 'review-similarity'] as const)(
    'preserves the full classification when optional %s suggestions reference invalid pairs',
    async (mode) => {
      const request = vi.fn(
        async (_profile: ModelProfile, context: AiOrganizationContext) => ({
          folders: ['taxonomy', 'merge-taxonomy'].includes(context.mode)
            ? [{ path: ['资料'], purpose: '用途分类' }]
            : [],
          assignments:
            context.mode === 'assign'
              ? context.bookmarks.map((bookmark) => ({
                  bookmarkId: bookmark.id,
                  folderPath: ['资料'],
                  confidence: 'high' as const,
                  summary: '',
                  reason: '主要用途'
                }))
              : [],
          ...(context.mode === 'assign' || context.mode === 'review-similarity'
            ? {
                similarities:
                  context.mode === mode
                    ? [
                        pair('a', 'unknown'),
                        ...(mode === 'review-similarity'
                          ? [pair('a', 'c')]
                          : [])
                      ]
                    : []
              }
            : {})
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
      const report = (progress: OrganizationPlanningProgress) => {
        last = structuredClone(progress);
      };
      const plan = await planner.plan(input, profile, report, {
        concurrency: 1
      });
      expect(plan.assignments.map((row) => row.bookmarkId)).toEqual([
        'a',
        'b',
        'c'
      ]);
      expect(plan.similarities).toEqual([]);
      const affected = last.batches!.find(
        (row) => row.stage === (mode === 'assign' ? 'assigning' : 'reviewing')
      )!;
      expect(affected.status).toBe('completed');
      expect(affected.summary).toContain('忽略');
      const saved = {
        resumeBatches: last.batches,
        resumeFolders: last.folders,
        concurrency: 1
      };
      request.mockClear();
      const resumed = await planner.plan(input, profile, report, saved);
      expect(resumed.assignments).toEqual(plan.assignments);
      expect(resumed.similarities).toEqual([]);
      expect(request).not.toHaveBeenCalled();
      expect(
        last.batches!.find((row) => row.id === affected.id)!.summary
      ).toContain('忽略');
    }
  );
});
