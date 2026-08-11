import { describe, expect, it, vi } from 'vitest';
import { AiAdapterRegistry } from '../../../src/ai/adapter-registry';
import type { AiRequestContext, ModelProfile } from '../../../src/ai/types';
import { SmartCapturePlanner } from '../../../src/capture-agent';

const profile: ModelProfile = {
  id: 'profile',
  version: '1',
  name: 'Classifier',
  protocol: 'openai-chat',
  endpoint: 'https://model.test',
  model: 'model',
  apiKey: 'secret',
  timeoutMs: 10_000,
  capabilities: ['classify', 'rename', 'summarize'],
  state: 'verified'
};

describe('SmartCapturePlanner', () => {
  it('keeps private URL queries local and limits model context', async () => {
    let context: AiRequestContext | undefined;
    const adapter = {
      protocol: 'openai-chat' as const,
      testConnection: vi.fn(),
      analyze: vi.fn(async (_profile, nextContext: AiRequestContext) => {
        context = nextContext;
        return {
          folderPath: ['开发', 'AI'],
          title: 'Agent browser design',
          tags: ['Agent'],
          summary: 'A design note',
          confidence: 'high' as const,
          reason: 'Matches AI'
        };
      })
    };
    const registry = new AiAdapterRegistry();
    registry.register(adapter);
    const planner = new SmartCapturePlanner({
      bookmarks: {
        getTree: vi.fn().mockResolvedValue(treeWithRelatedBookmarks(8))
      },
      profiles: { list: vi.fn().mockResolvedValue([profile]) },
      settings: settings(),
      adapters: registry,
      metadata: {
        get: vi.fn(async (id: string) => ({
          bookmarkId: id,
          summary: `summary ${id}`,
          tags: [],
          note: 'private note',
          confidence: 'high' as const,
          reason: '',
          health: 'healthy' as const,
          updatedAt: 1
        }))
      }
    });

    const result = await planner.plan({
      source: {
        id: 'current',
        parentId: 'inbox',
        index: 0,
        title: 'Agent browser design',
        url: 'https://example.test/agent?token=private#section'
      },
      page: {
        description: 'Contact dev@example.test',
        text: 'Bearer abcdefghijklmnop'
      },
      preferences: []
    });

    expect(context?.url).toBe('https://example.test/agent');
    expect(context?.description).toBe('Contact [REDACTED_EMAIL]');
    expect(context?.pageText).toBe('Bearer [REDACTED_TOKEN]');
    expect(context?.availableFolderPaths?.length).toBeLessThanOrEqual(24);
    expect(context?.relatedBookmarks).toHaveLength(5);
    expect(JSON.stringify(context?.relatedBookmarks)).not.toContain(
      'private note'
    );
    expect(result.destination).toMatchObject({
      folderId: 'ai',
      newFolders: [],
      path: [
        { id: 'bar', title: '书签栏' },
        { id: 'dev', title: '开发' },
        { id: 'ai', title: 'AI' }
      ]
    });
  });

  it('turns one missing leaf into an approval-ready folder proposal', async () => {
    const registry = new AiAdapterRegistry();
    registry.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze: vi.fn().mockResolvedValue({
        folderPath: ['开发', 'AI', 'Agent'],
        title: 'Agent browser design',
        tags: [],
        summary: '',
        confidence: 'high',
        reason: 'Needs a focused leaf'
      })
    });
    const planner = new SmartCapturePlanner({
      bookmarks: { getTree: vi.fn().mockResolvedValue(baseTree()) },
      profiles: { list: vi.fn().mockResolvedValue([profile]) },
      settings: settings({ allowNewFolders: true }),
      adapters: registry
    });

    const result = await planner.plan({
      source: {
        id: 'current',
        parentId: 'inbox',
        index: 0,
        title: 'Agent browser design',
        url: 'https://example.test/agent'
      },
      page: { text: 'Agent browser design' },
      preferences: []
    });

    expect(result.destination).toMatchObject({
      folderId: 'ai',
      newFolders: ['Agent'],
      creationSource: 'automatic'
    });
  });

  it('uses the classification model for dialogue revision and marks explicit creation', async () => {
    const registry = new AiAdapterRegistry();
    const analyze = vi.fn().mockResolvedValue({
      folderPath: ['研究', '浏览器'],
      title: 'Agent browser design',
      tags: [],
      summary: '',
      confidence: 'high',
      reason: '已调整到研究目录'
    });
    registry.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze
    });
    const planner = new SmartCapturePlanner({
      bookmarks: { getTree: vi.fn().mockResolvedValue(baseTree()) },
      profiles: { list: vi.fn().mockResolvedValue([profile]) },
      settings: settings({ allowNewFolders: true }),
      adapters: registry
    });

    const result = await planner.revise({
      source: {
        id: 'current',
        parentId: 'inbox',
        index: 0,
        title: 'Agent browser design',
        url: 'https://example.test/agent'
      },
      session: {
        id: 'session',
        bookmarkId: 'current',
        trigger: 'native-bookmark',
        sourceSnapshot: {
          id: 'current',
          parentId: 'inbox',
          index: 0,
          title: 'Agent browser design',
          url: 'https://example.test/agent'
        },
        state: 'adjusting',
        activities: [],
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        expiresAt: 2
      },
      message: '新建研究/浏览器目录并放进去',
      preferences: []
    });

    expect(analyze).toHaveBeenCalledOnce();
    expect(result.destination.creationSource).toBe('explicit-user');
  });

  it('passes the depth preference to AI and caps newly created levels locally', async () => {
    let context: AiRequestContext | undefined;
    const registry = new AiAdapterRegistry();
    registry.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze: vi.fn(async (_profile, nextContext: AiRequestContext) => {
        context = nextContext;
        return {
          folderPath: ['全新目录', '一级', '二级', '三级'],
          title: 'Agent browser design',
          tags: [],
          summary: '',
          confidence: 'high' as const,
          reason: '建议建立细分目录'
        };
      })
    });
    const planner = new SmartCapturePlanner({
      bookmarks: { getTree: vi.fn().mockResolvedValue(baseTree()) },
      profiles: { list: vi.fn().mockResolvedValue([profile]) },
      settings: settings({
        allowNewFolders: true,
        maxNewFolderLevels: 2,
        preferredFolderDepth: 4
      }),
      adapters: registry
    });

    const result = await planner.plan({
      source: {
        id: 'current',
        parentId: 'inbox',
        index: 0,
        title: 'Agent browser design',
        url: 'https://example.test/agent'
      },
      page: { text: 'Agent browser design' },
      preferences: []
    });

    expect(context).toMatchObject({
      maxNewFolderLevels: 2,
      preferredFolderDepth: 4
    });
    expect(result.destination).toMatchObject({
      newFolders: ['全新目录', '一级'],
      maxNewFolderLevels: 2
    });
  });

  it('prioritizes existing folder candidates near the preferred depth', async () => {
    let context: AiRequestContext | undefined;
    const registry = new AiAdapterRegistry();
    registry.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze: vi.fn(async (_profile, nextContext: AiRequestContext) => {
        context = nextContext;
        return {
          folderPath: ['开发', 'AI'],
          title: '无关页面',
          tags: [],
          summary: '',
          confidence: 'high' as const,
          reason: '复用已有目录'
        };
      })
    });
    const planner = new SmartCapturePlanner({
      bookmarks: {
        getTree: vi
          .fn()
          .mockResolvedValue([
            ...baseTree(),
            { id: 'agent', parentId: 'ai', index: 0, title: 'Agent' }
          ])
      },
      profiles: { list: vi.fn().mockResolvedValue([profile]) },
      settings: settings({ preferredFolderDepth: 3 }),
      adapters: registry
    });

    await planner.plan({
      source: {
        id: 'current',
        parentId: 'missing',
        index: 0,
        title: '无关页面',
        url: 'https://example.test'
      },
      preferences: []
    });

    expect(context?.availableFolderPaths?.[0]).toBe('开发/AI/Agent');
  });

  it('uses configured web search and vision and reports their auditable steps', async () => {
    let context: AiRequestContext | undefined;
    const registry = new AiAdapterRegistry();
    registry.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze: vi.fn(async (_profile, nextContext: AiRequestContext) => {
        context = nextContext;
        return {
          folderPath: ['开发', 'AI'],
          title: '视觉 Agent 页面',
          tags: ['AI'],
          summary: '结合页面与搜索结果判断',
          confidence: 'high' as const,
          reason: '页面主题与 AI 工具相关',
          toolUsage: {
            vision: true,
            webSearch: 'used' as const
          }
        };
      })
    });
    const reportActivity = vi.fn().mockResolvedValue(undefined);
    const planner = new SmartCapturePlanner({
      bookmarks: { getTree: vi.fn().mockResolvedValue(baseTree()) },
      profiles: { list: vi.fn().mockResolvedValue([profile]) },
      settings: settings({ enableWebSearch: true, enableVision: true }),
      adapters: registry
    });

    await planner.plan({
      source: {
        id: 'current',
        parentId: 'inbox',
        index: 0,
        title: 'Agent 页面',
        url: 'https://example.test/agent'
      },
      page: {
        text: 'Agent browser design',
        imageDataUrl: 'data:image/jpeg;base64,AA=='
      },
      preferences: [],
      reportActivity
    });

    expect(context).toMatchObject({
      imageDataUrl: 'data:image/jpeg;base64,AA==',
      webSearch: true
    });
    expect(reportActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'vision',
        status: 'completed',
        label: '页面截图识别完成'
      })
    );
    expect(reportActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'web-search',
        status: 'completed',
        label: '联网搜索完成'
      })
    );
  });
});

function settings(patch: Record<string, unknown> = {}) {
  return {
    getProfileAssignments: vi.fn().mockResolvedValue({ classify: 'profile@1' }),
    getSmartBookmarkSettings: vi.fn().mockResolvedValue({
      allowNewFolders: false,
      folderCreationLevel: 'weak',
      maxNewFolderLevels: 1,
      preferredFolderDepth: 2,
      smartRename: true,
      renameMaxLength: 50,
      captureNativeBookmarks: true,
      ...patch
    }),
    getPromptRules: vi.fn().mockResolvedValue(''),
    getRules: vi.fn().mockResolvedValue([])
  };
}

function baseTree() {
  return [
    { id: 'bar', parentId: '0', index: 0, title: '书签栏' },
    { id: 'inbox', parentId: 'bar', index: 0, title: '收件箱' },
    { id: 'dev', parentId: 'bar', index: 1, title: '开发' },
    { id: 'ai', parentId: 'dev', index: 0, title: 'AI' },
    { id: 'research', parentId: 'bar', index: 2, title: '研究' }
  ];
}

function treeWithRelatedBookmarks(count: number) {
  return [
    ...baseTree(),
    ...Array.from({ length: count }, (_, index) => ({
      id: `related-${index}`,
      parentId: 'ai',
      index,
      title: `Agent browser design ${index}`,
      url: `https://example.test/agent/${index}`
    }))
  ];
}
