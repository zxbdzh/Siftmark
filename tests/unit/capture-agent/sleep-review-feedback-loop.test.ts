import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiAdapterRegistry } from '../../../src/ai/adapter-registry';
import type {
  AiCaptureReviewContext,
  AiRequestContext,
  ModelProfile
} from '../../../src/ai/types';
import {
  CaptureSleepReviewService,
  DexieCaptureLearningRepository,
  DexieCapturePreferenceRepository,
  DexieCaptureSessionRepository,
  SmartCapturePlanner,
  type CaptureMemoryReviewer,
  type CaptureSession
} from '../../../src/capture-agent';
import type { SleepReviewStatus } from '../../../src/settings/settings-repository';
import { openSiftmarkDatabase } from '../../../src/storage/database';

const databaseNames: string[] = [];

describe('sleep review feedback loop', () => {
  afterEach(async () => {
    await Promise.all(
      databaseNames.splice(0).map((name) => Dexie.delete(name))
    );
  });

  it('accumulates cross-batch evidence and feeds a real learned memory into planning', async () => {
    const name = `siftmark-sleep-feedback-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = openSiftmarkDatabase(name);
    const sessions = new DexieCaptureSessionRepository(database);
    const learning = new DexieCaptureLearningRepository(database);
    const preferences = new DexieCapturePreferenceRepository(database);
    let status: SleepReviewStatus = { state: 'idle' };
    const reviewer: CaptureMemoryReviewer = {
      review: vi.fn(async ({ examples }: AiCaptureReviewContext) => {
        const matching = examples.filter(
          (example) =>
            example.domain === 'example.test' &&
            example.resolution === 'allowed' &&
            example.destinationPath.join('/') === '开发/AI'
        );
        return {
          memories:
            matching.length >= 2
              ? [
                  {
                    domain: 'example.test',
                    action: 'prefer-folder' as const,
                    destinationPath: ['开发', 'AI'],
                    confidence: 'high' as const,
                    summary: '重复批准归入开发 / AI'
                  }
                ]
              : [],
          reviewSummary: matching.length >= 2 ? '发现稳定规律' : '暂无稳定规律'
        };
      })
    };
    const service = new CaptureSleepReviewService({
      learning,
      reviewer,
      settings: {
        getSleepReviewSettings: vi.fn().mockResolvedValue({
          enabled: true,
          idleMinutes: 15,
          batchSize: 3
        }),
        getSleepReviewStatus: vi.fn(async () => status),
        setSleepReviewStatus: vi.fn(async (next) => {
          status = next;
        })
      },
      hasActiveCapture: vi.fn().mockResolvedValue(false),
      now: vi.fn().mockReturnValue(100_000)
    });

    await Promise.all([
      sessions.put(resolvedSession('first-example', 'example.test', 10)),
      sessions.put(resolvedSession('first-alpha', 'alpha.test', 11)),
      sessions.put(resolvedSession('first-beta', 'beta.test', 12))
    ]);
    await expect(service.review({ force: true })).resolves.toMatchObject({
      outcome: 'reviewed',
      learnedMemories: 0
    });

    await Promise.all([
      sessions.put(resolvedSession('second-example', 'example.test', 20)),
      sessions.put(resolvedSession('second-gamma', 'gamma.test', 21)),
      sessions.put(resolvedSession('second-delta', 'delta.test', 22))
    ]);
    await expect(service.review({ force: true })).resolves.toMatchObject({
      outcome: 'learned',
      learnedMemories: 1
    });

    const matchingPreferences = await preferences.listMatching(
      'https://example.test/new',
      'New page'
    );
    expect(matchingPreferences).toEqual([
      expect.objectContaining({
        kind: 'learned',
        domain: 'example.test',
        evidenceCount: 2
      })
    ]);
    const memoryId = matchingPreferences[0]!.id;
    await expect(sessions.get('first-example')).resolves.toMatchObject({
      learningReview: { outcome: 'learned', memoryIds: [memoryId] }
    });
    await expect(sessions.get('first-alpha')).resolves.toMatchObject({
      learningReview: { outcome: 'no-pattern', memoryIds: [] }
    });
    await expect(sessions.get('second-example')).resolves.toMatchObject({
      learningReview: { outcome: 'learned', memoryIds: [memoryId] }
    });

    let context: AiRequestContext | undefined;
    const adapters = new AiAdapterRegistry();
    adapters.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze: vi.fn(async (_profile, nextContext) => {
        context = nextContext;
        return {
          folderPath: ['开发', 'AI'],
          title: 'New page',
          tags: [],
          summary: '',
          confidence: 'high' as const,
          reason: '采用历史记忆'
        };
      })
    });
    const planner = plannerFor(adapters);
    const plan = await planner.plan({
      source: {
        id: 'current',
        parentId: 'inbox',
        index: 0,
        title: 'New page',
        url: 'https://example.test/new'
      },
      preferences: matchingPreferences
    });

    expect(context?.availableFolderPaths?.[0]).toBe('开发/AI');
    expect(plan).toMatchObject({
      memoryInfluence: {
        matched: [expect.objectContaining({ id: memoryId, evidenceCount: 2 })],
        adoptedMemoryIds: [memoryId]
      }
    });
    database.close();
  });
});

const profile: ModelProfile = {
  id: 'profile',
  version: '1',
  name: 'Classifier',
  protocol: 'openai-chat',
  endpoint: 'https://model.test',
  model: 'model',
  apiKey: 'secret',
  timeoutMs: 10_000,
  capabilities: ['classify'],
  state: 'verified'
};

function plannerFor(adapters: AiAdapterRegistry): SmartCapturePlanner {
  return new SmartCapturePlanner({
    bookmarks: { getTree: vi.fn().mockResolvedValue(bookmarkTree()) },
    profiles: { list: vi.fn().mockResolvedValue([profile]) },
    settings: {
      getProfileAssignments: vi
        .fn()
        .mockResolvedValue({ classify: 'profile@1' }),
      getSmartBookmarkSettings: vi.fn().mockResolvedValue({
        allowNewFolders: false,
        folderCreationLevel: 'weak',
        maxNewFolderLevels: 0,
        preferredFolderDepth: 2,
        enableWebSearch: false,
        enableVision: false,
        smartRename: true,
        renameMaxLength: 50,
        captureNativeBookmarks: true
      }),
      getPromptRules: vi.fn().mockResolvedValue(''),
      getRules: vi.fn().mockResolvedValue([])
    },
    adapters
  });
}

function bookmarkTree() {
  return [
    { id: 'bar', parentId: '0', index: 0, title: '书签栏' },
    { id: 'inbox', parentId: 'bar', index: 0, title: '收件箱' },
    { id: 'dev', parentId: 'bar', index: 1, title: '开发' },
    { id: 'ai', parentId: 'dev', index: 0, title: 'AI' },
    { id: 'research', parentId: 'bar', index: 2, title: '研究' }
  ];
}

function resolvedSession(
  id: string,
  domain: string,
  timestamp: number
): CaptureSession {
  return {
    id,
    bookmarkId: `bookmark-${id}`,
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: `bookmark-${id}`,
      parentId: 'inbox',
      index: 0,
      title: id,
      url: `https://${domain}/docs/${id}`
    },
    state: 'applied',
    resolution: 'allowed',
    resolvedAt: timestamp,
    plan: {
      destination: {
        folderId: 'ai',
        path: [
          { id: 'bar', title: '书签栏' },
          { id: 'dev', title: '开发' },
          { id: 'ai', title: 'AI' }
        ],
        newFolders: []
      },
      title: id,
      tags: [],
      summary: '',
      confidence: 'high',
      reason: '',
      relatedBookmarks: [],
      generatedAt: timestamp
    },
    activities: [],
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + 100
  };
}
