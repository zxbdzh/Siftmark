import { describe, expect, it } from 'vitest';
import {
  ChromeSettingsRepository,
  defaultSleepReviewSettings,
  defaultSmartBookmarkSettings,
  settingsKeys,
  type SleepReviewAttempt
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

  it('keeps metered sleep review opt-in and clamps its idle budget', async () => {
    const values: Record<string, unknown> = {};
    const repository = new ChromeSettingsRepository({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items);
      }
    });

    await expect(repository.getSleepReviewSettings()).resolves.toEqual(
      defaultSleepReviewSettings
    );
    await repository.setSleepReviewSettings({
      enabled: true,
      idleMinutes: 1,
      batchSize: 99
    });

    await expect(repository.getSleepReviewSettings()).resolves.toEqual({
      enabled: true,
      idleMinutes: 5,
      batchSize: 12
    });
  });

  it('normalizes and bounds the local sleep-review audit trail', async () => {
    const values: Record<string, unknown> = {};
    const repository = new ChromeSettingsRepository({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items);
      }
    });
    const attempts: SleepReviewAttempt[] = Array.from(
      { length: 10 },
      (_, index) => ({
        trigger: index % 2 ? 'idle' : 'alarm',
        attemptedAt: index + 1,
        outcome: 'waiting',
        summary: `已积累 ${index} / 3 个新结果`,
        reviewedSessions: -1,
        learnedMemories: index
      })
    );

    await repository.setSleepReviewStatus({
      state: 'waiting',
      lastTrigger: 'idle',
      lastAttemptAt: 10,
      attempts
    });

    const status = await repository.getSleepReviewStatus();
    expect(status.attempts).toHaveLength(8);
    expect(status.attempts?.[0]).toMatchObject({
      attemptedAt: 3,
      reviewedSessions: 0
    });
    expect(status.attempts?.at(-1)).toMatchObject({
      attemptedAt: 10,
      learnedMemories: 9
    });
  });
});
