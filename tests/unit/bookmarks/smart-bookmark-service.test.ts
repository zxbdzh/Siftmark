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
      getTree: vi.fn().mockResolvedValue([
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
});
