import { describe, expect, it } from 'vitest';
import {
  ChromeSettingsRepository,
  defaultSmartBookmarkSettings,
  settingsKeys
} from '../../../src/settings/settings-repository';

describe('ChromeSettingsRepository', () => {
  it('persists independent sort choices per folder', async () => {
    const values: Record<string, unknown> = {};
    const repository = new ChromeSettingsRepository({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items);
      }
    });
    await repository.setFolderSort('folder-a', {
      field: 'title',
      direction: 'desc'
    });
    await repository.setFolderSort('folder-b', {
      field: 'health',
      direction: 'asc'
    });
    await expect(repository.getFolderSort('folder-a')).resolves.toEqual({
      field: 'title',
      direction: 'desc'
    });
    await expect(repository.getFolderSort('folder-b')).resolves.toEqual({
      field: 'health',
      direction: 'asc'
    });
  });

  it('migrates and clamps AI folder level settings', async () => {
    const values: Record<string, unknown> = {
      [settingsKeys.smartBookmark]: {
        allowNewFolders: true,
        folderCreationLevel: 'weak',
        smartRename: true,
        renameMaxLength: 12,
        captureNativeBookmarks: true
      }
    };
    const repository = new ChromeSettingsRepository({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items);
      }
    });

    await expect(repository.getSmartBookmarkSettings()).resolves.toMatchObject({
      maxNewFolderLevels: 1,
      preferredFolderDepth: 2,
      enableWebSearch: true,
      enableVision: true
    });

    values[settingsKeys.smartBookmark] = {
      ...defaultSmartBookmarkSettings,
      maxNewFolderLevels: 99,
      preferredFolderDepth: 0
    };
    await expect(repository.getSmartBookmarkSettings()).resolves.toMatchObject({
      maxNewFolderLevels: 5,
      preferredFolderDepth: 1
    });
  });

  it('persists an explicit opt-out from web search and vision', async () => {
    const values: Record<string, unknown> = {};
    const repository = new ChromeSettingsRepository({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items);
      }
    });

    await repository.setSmartBookmarkSettings({
      ...defaultSmartBookmarkSettings,
      enableWebSearch: false,
      enableVision: false
    });

    await expect(repository.getSmartBookmarkSettings()).resolves.toMatchObject({
      enableWebSearch: false,
      enableVision: false
    });
  });
});
