import { describe, expect, it, vi } from 'vitest';
import { AiAdapterRegistry } from '../../../src/ai/adapter-registry';
import type { AiRequestContext, ModelProfile } from '../../../src/ai/types';
import { SmartBookmarkService } from '../../../src/bookmarks/smart-bookmark-service';
import type { ChromeSmartBookmarkHistoryRepository } from '../../../src/bookmarks/history-repository';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';
import type { ProfileRepository } from '../../../src/ai/profiles/profile-repository';
import type { ChromeSettingsRepository } from '../../../src/settings/settings-repository';

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

describe('SmartBookmarkService', () => {
  it('sanitizes legacy save context immediately before the adapter call', async () => {
    const folders = Array.from({ length: 30 }, (_, index) => ({
      id: `folder-${index}`,
      parentId: 'bar',
      index,
      title: `Folder ${index}`
    }));
    const existing = {
      id: 'bookmark',
      parentId: 'folder-0',
      index: 0,
      title: 'Owner dev@example.test',
      url: 'https://user:password@example.test/page?token=x#section'
    };
    const bookmarks = {
      getTree: vi
        .fn()
        .mockResolvedValue([
          { id: 'bar', parentId: '0', index: 0, title: 'Bookmarks Bar' },
          ...folders,
          existing
        ]),
      get: vi.fn().mockResolvedValue(existing),
      create: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      remove: vi.fn()
    } as unknown as BookmarkRepository;
    const profiles = {
      list: vi.fn().mockResolvedValue([profile])
    } as unknown as ProfileRepository;
    const settings = {
      getProfileAssignments: vi
        .fn()
        .mockResolvedValue({ classify: 'profile@1' }),
      getSmartBookmarkSettings: vi.fn().mockResolvedValue({
        allowNewFolders: false,
        folderCreationLevel: 'weak',
        maxNewFolderLevels: 1,
        preferredFolderDepth: 2,
        enableWebSearch: false,
        enableVision: false,
        smartRename: false,
        renameMaxLength: 50,
        captureNativeBookmarks: true
      }),
      getPromptRules: vi.fn().mockResolvedValue('Use sk-abcdefghijklmnop')
    } as unknown as ChromeSettingsRepository;
    const history = {
      add: vi.fn().mockResolvedValue(undefined)
    } as unknown as ChromeSmartBookmarkHistoryRepository;
    const analyze = vi.fn().mockResolvedValue({
      folderPath: ['Folder 0'],
      title: existing.title,
      tags: [],
      summary: '',
      confidence: 'high',
      reason: 'Matches folder'
    });
    const adapters = new AiAdapterRegistry();
    adapters.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze
    });
    const service = new SmartBookmarkService(
      bookmarks,
      profiles,
      settings,
      adapters,
      history,
      undefined,
      () => 'history',
      () => 1
    );

    await service.save({
      bookmarkId: existing.id,
      title: existing.title,
      url: existing.url,
      description: `Contact dev@example.test ${'d'.repeat(600)}`,
      pageText: `Bearer abcdefghijklmnop ${'p'.repeat(7_000)}`
    });

    const sent = analyze.mock.calls[0]?.[1] as AiRequestContext | undefined;
    expect(sent).toMatchObject({
      title: 'Owner [REDACTED_EMAIL]',
      url: 'https://example.test/page',
      additionalRules: 'Use [REDACTED_API_KEY]'
    });
    expect(sent?.description).toHaveLength(500);
    expect(sent?.description).toContain('[REDACTED_EMAIL]');
    expect(sent?.pageText).toHaveLength(6_000);
    expect(sent?.pageText).toContain('Bearer [REDACTED_TOKEN]');
    expect(sent?.availableFolderPaths).toHaveLength(24);
  });

  it('ranks a relevant directory beyond the first 24 and only moves existing bookmarks in organize mode', async () => {
    const folders = Array.from({ length: 30 }, (_, index) => ({
      id: `f${index}`,
      parentId: 'bar',
      title: `无关 ${index}`,
      index
    }));
    const existing = {
      id: 'bookmark',
      parentId: 'f0',
      title: '网络代理配置指南',
      url: 'https://example.test/guide',
      index: 0
    };
    const nodes = [
      { id: 'bar', parentId: '0', index: 0, title: '书签栏' },
      ...folders,
      { id: 'proxy', parentId: 'bar', index: 30, title: '网络代理服务' },
      existing
    ];
    const bookmarks = {
      getTree: vi.fn().mockResolvedValue(nodes),
      get: vi.fn().mockResolvedValue(existing),
      move: vi.fn().mockResolvedValue({ ...existing, parentId: 'proxy' }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn()
    } as unknown as BookmarkRepository;
    const profiles = {
      list: vi.fn().mockResolvedValue([profile])
    } as unknown as ProfileRepository;
    const settings = {
      getProfileAssignments: vi.fn().mockResolvedValue({}),
      getSmartBookmarkSettings: vi
        .fn()
        .mockResolvedValue({
          allowNewFolders: true,
          smartRename: true,
          folderCreationLevel: 'strong',
          preferredFolderDepth: 2,
          renameMaxLength: 12
        }),
      getPromptRules: vi.fn().mockResolvedValue('')
    } as unknown as ChromeSettingsRepository;
    const history = {
      add: vi.fn()
    } as unknown as ChromeSmartBookmarkHistoryRepository;
    const analyze = vi
      .fn()
      .mockResolvedValue({
        folderPath: ['网络代理服务'],
        title: '模型改名',
        tags: [],
        summary: '',
        reason: '主要用途是网络代理',
        confidence: 'high'
      });
    const adapters = new AiAdapterRegistry();
    adapters.register({
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze
    });
    const service = new SmartBookmarkService(
      bookmarks,
      profiles,
      settings,
      adapters,
      history
    );
    const input = {
      bookmarkId: existing.id,
      title: existing.title,
      url: existing.url,
      contextNodes: nodes,
      classifyProfile: { ...profile, model: 'locked-model' },
      allowNewFolders: false,
      classifyProfileKey: 'profile@1',
      smartRename: false
    };
    const result = await service.save(input);
    expect(result.analysis).toMatchObject({
      sourceFolderPath: ['无关 0'],
      candidateFolderPaths: expect.arrayContaining([
        ['网络代理服务']
      ]),
      selectedFolderPath: ['网络代理服务'],
      confidence: 'high',
      reason: '主要用途是网络代理',
      action: 'moved'
    });
    expect(analyze.mock.calls[0]![1]).toMatchObject({
      folderCreationPolicy: 'off'
    });
    expect(analyze.mock.calls[0]![1].availableFolderPaths[0]).toBe(
      '网络代理服务'
    );
    expect(bookmarks.move).toHaveBeenCalledWith('bookmark', 'proxy');
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.update).not.toHaveBeenCalled();
    expect(history.add).not.toHaveBeenCalled();
    vi.mocked(bookmarks.move).mockClear();
    analyze.mockResolvedValueOnce({
      folderPath: ['不存在'],
      title: '',
      tags: [],
      summary: '',
      reason: '',
      confidence: 'high'
    });
    await expect(service.save(input)).rejects.toThrow('保留原位');
    expect(bookmarks.move).not.toHaveBeenCalled();
    vi.mocked(bookmarks.get).mockResolvedValueOnce(null);
    await expect(service.save(input)).rejects.toThrow('已删除');
    expect(bookmarks.create).not.toHaveBeenCalled();
  });
});
