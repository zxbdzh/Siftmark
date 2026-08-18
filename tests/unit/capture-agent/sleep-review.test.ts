import { describe, expect, it, vi } from 'vitest';
import {
  CaptureSleepReviewService,
  type CaptureLearningRepository,
  type CaptureMemoryReviewer,
  type CaptureSession
} from '../../../src/capture-agent';
import type {
  SleepReviewSettings,
  SleepReviewStatus
} from '../../../src/settings/settings-repository';

describe('CaptureSleepReviewService', () => {
  it('waits for enough new resolved sessions without spending model quota', async () => {
    const dependencies = dependenciesFor([
      resolvedSession('one'),
      resolvedSession('two')
    ]);
    const service = new CaptureSleepReviewService(dependencies);

    await expect(service.review({ trigger: 'idle' })).resolves.toMatchObject({
      outcome: 'waiting',
      reviewedSessions: 0
    });
    expect(dependencies.reviewer.review).not.toHaveBeenCalled();
    expect(dependencies.learning.commit).not.toHaveBeenCalled();
    await expect(
      dependencies.settings.getSleepReviewStatus()
    ).resolves.toMatchObject({
      state: 'waiting',
      lastTrigger: 'idle',
      lastAttemptAt: 100_000,
      attempts: [
        expect.objectContaining({
          trigger: 'idle',
          outcome: 'waiting',
          summary: '已积累 2 / 3 个新结果'
        })
      ]
    });
  });

  it('coalesces repeated compensation checks and keeps a bounded audit trail', async () => {
    const dependencies = dependenciesFor([]);
    let now = 100_000;
    dependencies.now.mockImplementation(() => now);
    const service = new CaptureSleepReviewService(dependencies);

    await service.review({ trigger: 'alarm' });
    now += 5 * 60_000;
    await service.review({ trigger: 'alarm' });

    const repeated = await dependencies.settings.getSleepReviewStatus();
    expect(repeated.attempts).toHaveLength(1);
    expect(repeated.attempts?.[0]).toMatchObject({
      trigger: 'alarm',
      attemptedAt: now,
      outcome: 'waiting'
    });

    for (let index = 0; index < 10; index += 1) {
      now += 1;
      await service.review({ trigger: index % 2 ? 'idle' : 'startup' });
    }

    const bounded = await dependencies.settings.getSleepReviewStatus();
    expect(bounded.attempts).toHaveLength(8);
  });

  it('reviews each resolved session once and commits learned memory atomically', async () => {
    const sessions = [
      resolvedSession('one'),
      resolvedSession('two'),
      resolvedSession('three')
    ];
    const dependencies = dependenciesFor(sessions);
    const service = new CaptureSleepReviewService(dependencies);

    const first = await service.review();

    expect(first).toMatchObject({
      outcome: 'learned',
      reviewedSessions: 3,
      learnedMemories: 1
    });
    expect(dependencies.reviewer.review).toHaveBeenCalledWith(
      expect.objectContaining({
        examples: expect.arrayContaining([
          expect.objectContaining({
            domain: 'example.test',
            destinationPath: ['开发', 'AI'],
            resolution: 'allowed'
          })
        ])
      })
    );
    expect(dependencies.learning.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        reviews: expect.arrayContaining([
          expect.objectContaining({ sessionId: 'one', outcome: 'learned' }),
          expect.objectContaining({ sessionId: 'two', outcome: 'learned' }),
          expect.objectContaining({ sessionId: 'three', outcome: 'learned' })
        ]),
        memories: [
          expect.objectContaining({
            id: 'sleep-review:example.test',
            kind: 'learned',
            source: 'sleep-review',
            destinationPath: ['开发', 'AI'],
            evidenceCount: 3
          })
        ]
      })
    );

    dependencies.learning.listUnreviewed.mockResolvedValueOnce([]);
    await expect(service.review({ force: true })).resolves.toMatchObject({
      outcome: 'waiting'
    });
    expect(dependencies.reviewer.review).toHaveBeenCalledOnce();
  });

  it('rejects invented memory paths and never exposes a bookmark mutation seam', async () => {
    const dependencies = dependenciesFor([
      resolvedSession('one'),
      resolvedSession('two'),
      resolvedSession('three')
    ]);
    dependencies.reviewer.review.mockResolvedValueOnce({
      memories: [
        {
          domain: 'example.test',
          action: 'prefer-folder',
          destinationPath: ['模型凭空创建的目录'],
          confidence: 'high',
          summary: '无法由证据支持'
        }
      ],
      reviewSummary: '没有可安全采用的规律'
    });
    const service = new CaptureSleepReviewService(dependencies);

    await expect(service.review()).resolves.toMatchObject({
      outcome: 'reviewed',
      learnedMemories: 0
    });
    expect(dependencies.learning.commit).toHaveBeenCalledWith(
      expect.objectContaining({ memories: [] })
    );
    expect(dependencies).not.toHaveProperty('bookmarks');
  });

  it('keeps conflicting same-domain memories instead of overwriting the legacy one', async () => {
    const sessions = [
      resolvedSession('one'),
      resolvedSession('two'),
      resolvedSession('three')
    ].map((session) => ({
      ...session,
      plan: {
        ...session.plan!,
        destination: {
          ...session.plan!.destination,
          folderId: 'research',
          path: [{ id: 'research', title: '研究' }]
        }
      }
    }));
    const dependencies = dependenciesFor(sessions);
    dependencies.learning.getMemory.mockImplementation(async (id: string) =>
      id === 'sleep-review:example.test'
        ? {
            id,
            kind: 'learned',
            domain: 'example.test',
            action: 'prefer-folder',
            destinationPath: ['开发', 'AI'],
            source: 'sleep-review',
            sourceSessionId: 'old',
            reviewSummary: '旧规律',
            evidenceCount: 3,
            confidence: 'high',
            reviewedAt: 1,
            createdAt: 1,
            updatedAt: 1
          }
        : null
    );
    dependencies.reviewer.review.mockResolvedValueOnce({
      memories: [
        {
          domain: 'example.test',
          action: 'prefer-folder',
          destinationPath: ['研究'],
          confidence: 'high',
          summary: '新的规律'
        }
      ],
      reviewSummary: '发现新的规律'
    });

    await new CaptureSleepReviewService(dependencies).review();

    expect(dependencies.learning.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        memories: [
          expect.objectContaining({
            destinationPath: ['研究'],
            id: expect.stringMatching(
              /^sleep-review:example\.test:prefer-folder:/
            )
          })
        ]
      })
    );
  });

  it('continues a legacy root-qualified memory instead of creating a duplicate', async () => {
    const sessions = [
      resolvedSession('one'),
      resolvedSession('two'),
      resolvedSession('three')
    ];
    const dependencies = dependenciesFor(sessions);
    dependencies.learning.getMemory.mockImplementation(async (id: string) =>
      id === 'sleep-review:example.test'
        ? {
            id,
            kind: 'learned',
            domain: 'example.test',
            action: 'prefer-folder',
            destinationPath: ['书签栏', '开发', 'AI'],
            source: 'sleep-review',
            sourceSessionId: 'old',
            reviewSummary: '旧规律',
            evidenceCount: 2,
            confidence: 'high',
            reviewedAt: 1,
            createdAt: 1,
            updatedAt: 1
          }
        : null
    );

    await new CaptureSleepReviewService(dependencies).review();

    expect(dependencies.learning.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        memories: [
          expect.objectContaining({
            id: 'sleep-review:example.test',
            destinationPath: ['开发', 'AI'],
            evidenceCount: 5
          })
        ]
      })
    );
  });

  it('keeps pending new sessions visible when old evidence uses batch capacity', async () => {
    const stableNew = resolvedSession('stable-new');
    const otherNewOne = {
      ...resolvedSession('other-new-one'),
      sourceSnapshot: {
        ...resolvedSession('other-new-one').sourceSnapshot,
        url: 'https://other-one.test'
      }
    };
    const otherNewTwo = {
      ...resolvedSession('other-new-two'),
      sourceSnapshot: {
        ...resolvedSession('other-new-two').sourceSnapshot,
        url: 'https://other-two.test'
      }
    };
    const oldOne = { ...resolvedSession('old-one'), updatedAt: 1 };
    const oldTwo = { ...resolvedSession('old-two'), updatedAt: 2 };
    const dependencies = dependenciesFor([
      stableNew,
      otherNewOne,
      otherNewTwo
    ]);
    dependencies.learning.listReviewCandidates.mockResolvedValue([
      oldOne,
      oldTwo,
      stableNew,
      otherNewOne,
      otherNewTwo
    ]);
    dependencies.settings.getSleepReviewSettings.mockResolvedValue({
      enabled: true,
      idleMinutes: 15,
      batchSize: 3
    });

    await expect(
      new CaptureSleepReviewService(dependencies).review()
    ).resolves.toMatchObject({ outcome: 'learned', reviewedSessions: 3 });

    expect(dependencies.learning.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        reviews: expect.arrayContaining([
          expect.objectContaining({ sessionId: 'stable-new' }),
          expect.objectContaining({ sessionId: 'old-one' })
        ])
      })
    );
    await expect(
      dependencies.settings.getSleepReviewStatus()
    ).resolves.toMatchObject({ pendingSessions: 1 });
  });
});

function dependenciesFor(sessions: CaptureSession[]) {
  const settings: SleepReviewSettings = {
    enabled: true,
    idleMinutes: 15,
    batchSize: 8
  };
  let status: SleepReviewStatus = { state: 'idle' };
  const learning = {
    listUnreviewed: vi.fn().mockResolvedValue(sessions),
    listReviewCandidates: vi.fn().mockResolvedValue(sessions),
    getMemory: vi.fn().mockResolvedValue(null),
    commit: vi.fn().mockResolvedValue(undefined)
  } satisfies CaptureLearningRepository;
  const reviewer = {
    review: vi.fn().mockResolvedValue({
      memories: [
        {
          domain: 'example.test',
          action: 'prefer-folder',
          destinationPath: ['开发', 'AI'],
          confidence: 'high',
          summary: '连续批准将该网站归入开发 / AI'
        }
      ],
      reviewSummary: '从 3 次收藏中整理出 1 条记忆'
    })
  } satisfies CaptureMemoryReviewer;
  return {
    learning,
    reviewer,
    settings: {
      getSleepReviewSettings: vi.fn().mockResolvedValue(settings),
      getSleepReviewStatus: vi.fn(async () => status),
      setSleepReviewStatus: vi.fn(async (next: SleepReviewStatus) => {
        status = next;
      })
    },
    hasActiveCapture: vi.fn().mockResolvedValue(false),
    now: vi.fn().mockReturnValue(100_000)
  };
}

function resolvedSession(id: string): CaptureSession {
  return {
    id,
    bookmarkId: `bookmark-${id}`,
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: `bookmark-${id}`,
      parentId: 'inbox',
      index: 0,
      title: `Agent 文档 ${id}`,
      url: `https://example.test/docs/${id}?token=private`
    },
    state: 'applied',
    resolution: 'allowed',
    resolvedAt: 10,
    plan: {
      destination: {
        folderId: 'ai',
        path: [
          { id: 'dev', title: '开发' },
          { id: 'ai', title: 'AI' }
        ],
        newFolders: []
      },
      title: `Agent 文档 ${id}`,
      tags: ['Agent'],
      summary: 'Agent 使用文档',
      confidence: 'high',
      reason: '与 AI 开发相关',
      relatedBookmarks: [],
      generatedAt: 1
    },
    activities: [],
    messages: [],
    createdAt: 1,
    updatedAt: 10,
    expiresAt: 100
  };
}
