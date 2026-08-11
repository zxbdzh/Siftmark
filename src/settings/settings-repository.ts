import { ruleSchema } from '../rules/rule-schema';
import type { Rule } from '../rules/types';
import type { DensityPreference, ThemePreference } from '../ui/theme/theme-store';

export const settingsKeys = {
  appearance: 'siftmark.settings.appearance.v1',
  rules: 'siftmark.settings.rules.v1',
  promptRules: 'siftmark.settings.prompt-rules.v1',
  specialFolders: 'siftmark.settings.special-folders.v1',
  recentFolder: 'siftmark.settings.recent-folder.v1',
  profileAssignments: 'siftmark.settings.profile-assignments.v1',
  folderSorts: 'siftmark.settings.folder-sorts.v1',
  smartBookmark: 'siftmark.settings.smart-bookmark.v1'
} as const;

export interface SettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface AppearanceSettings {
  theme: ThemePreference;
  density: DensityPreference;
}

export interface SpecialFolderSettings {
  inboxId?: string;
  archiveId?: string;
  recycleBinId?: string;
}

export type ProfileAssignments = Partial<
  Record<'classify' | 'rename' | 'summarize' | 'embed' | 'agent', string>
>;

export const smartBookmarkFolderLevelBounds = { min: 1, max: 5 } as const;

export interface SmartBookmarkSettings {
  allowNewFolders: boolean;
  folderCreationLevel: 'weak' | 'medium' | 'strong';
  maxNewFolderLevels: number;
  preferredFolderDepth: number;
  smartRename: boolean;
  renameMaxLength: number;
  captureNativeBookmarks: boolean;
}
export type BookmarkSortField = 'manual' | 'title' | 'domain' | 'createdAt' | 'updatedAt' | 'visitedAt' | 'health' | 'confidence';
export interface BookmarkSort { field: BookmarkSortField; direction: 'asc' | 'desc' }

const defaultAppearance: AppearanceSettings = { theme: 'system', density: 'comfortable' };
export const defaultSmartBookmarkSettings: SmartBookmarkSettings = {
  allowNewFolders: true,
  folderCreationLevel: 'weak',
  maxNewFolderLevels: 1,
  preferredFolderDepth: 2,
  smartRename: true,
  renameMaxLength: 12,
  captureNativeBookmarks: true
};

export class ChromeSettingsRepository {
  constructor(private readonly storage: SettingsStorageArea) {}

  async getAppearance(): Promise<AppearanceSettings> {
    const value = await this.read(settingsKeys.appearance);
    if (!isRecord(value)) return defaultAppearance;
    return {
      theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'system' ? value.theme : 'system',
      density: value.density === 'compact' ? 'compact' : 'comfortable'
    };
  }

  setAppearance(value: AppearanceSettings): Promise<void> {
    return this.write(settingsKeys.appearance, value);
  }

  async getRules(): Promise<Rule[]> {
    const value = await this.read(settingsKeys.rules);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = ruleSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  }

  setRules(value: Rule[]): Promise<void> {
    return this.write(settingsKeys.rules, value.map((rule) => ruleSchema.parse(rule)));
  }

  async getPromptRules(): Promise<string> {
    const value = await this.read(settingsKeys.promptRules);
    return typeof value === 'string' ? value : '';
  }

  setPromptRules(value: string): Promise<void> {
    return this.write(settingsKeys.promptRules, value.slice(0, 4_000));
  }

  async getSpecialFolders(): Promise<SpecialFolderSettings> {
    const value = await this.read(settingsKeys.specialFolders);
    if (!isRecord(value)) return {};
    return {
      ...(typeof value.inboxId === 'string' ? { inboxId: value.inboxId } : {}),
      ...(typeof value.archiveId === 'string' ? { archiveId: value.archiveId } : {}),
      ...(typeof value.recycleBinId === 'string' ? { recycleBinId: value.recycleBinId } : {})
    };
  }

  setSpecialFolders(value: SpecialFolderSettings): Promise<void> {
    return this.write(settingsKeys.specialFolders, value);
  }

  async getRecentFolder(): Promise<string | undefined> {
    const value = await this.read(settingsKeys.recentFolder);
    return typeof value === 'string' ? value : undefined;
  }

  setRecentFolder(folderId: string): Promise<void> {
    return this.write(settingsKeys.recentFolder, folderId);
  }

  async getProfileAssignments(): Promise<ProfileAssignments> {
    const value = await this.read(settingsKeys.profileAssignments);
    return isRecord(value) ? value as ProfileAssignments : {};
  }

  setProfileAssignments(value: ProfileAssignments): Promise<void> {
    return this.write(settingsKeys.profileAssignments, value);
  }

  async getSmartBookmarkSettings(): Promise<SmartBookmarkSettings> {
    const value = await this.read(settingsKeys.smartBookmark);
    if (!isRecord(value)) return defaultSmartBookmarkSettings;
    return normalizeSmartBookmarkSettings(value);
  }

  setSmartBookmarkSettings(value: SmartBookmarkSettings): Promise<void> {
    return this.write(
      settingsKeys.smartBookmark,
      normalizeSmartBookmarkSettings(value)
    );
  }

  async getFolderSort(folderId: string): Promise<BookmarkSort> {
    const value = await this.read(settingsKeys.folderSorts);
    if (!isRecord(value) || !isRecord(value[folderId])) return { field: 'manual', direction: 'asc' };
    const sort = value[folderId];
    const fields: BookmarkSortField[] = ['manual', 'title', 'domain', 'createdAt', 'updatedAt', 'visitedAt', 'health', 'confidence'];
    return { field: fields.includes(sort.field as BookmarkSortField) ? sort.field as BookmarkSortField : 'manual', direction: sort.direction === 'desc' ? 'desc' : 'asc' };
  }

  async setFolderSort(folderId: string, sort: BookmarkSort): Promise<void> {
    const current = await this.read(settingsKeys.folderSorts);
    await this.write(settingsKeys.folderSorts, { ...(isRecord(current) ? current : {}), [folderId]: sort });
  }

  private async read(key: string): Promise<unknown> {
    return (await this.storage.get(key))[key];
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.storage.set({ [key]: value });
  }
}

function normalizeSmartBookmarkSettings(
  value: Partial<Record<keyof SmartBookmarkSettings, unknown>>
): SmartBookmarkSettings {
  return {
    allowNewFolders: value.allowNewFolders === true,
    folderCreationLevel:
      value.folderCreationLevel === 'medium' ||
      value.folderCreationLevel === 'strong'
        ? value.folderCreationLevel
        : 'weak',
    maxNewFolderLevels: normalizeFolderLevel(
      value.maxNewFolderLevels,
      defaultSmartBookmarkSettings.maxNewFolderLevels
    ),
    preferredFolderDepth: normalizeFolderLevel(
      value.preferredFolderDepth,
      defaultSmartBookmarkSettings.preferredFolderDepth
    ),
    smartRename: value.smartRename !== false,
    renameMaxLength:
      typeof value.renameMaxLength === 'number'
        ? Math.min(50, Math.max(6, Math.round(value.renameMaxLength)))
        : 12,
    captureNativeBookmarks: value.captureNativeBookmarks === true
  };
}

function normalizeFolderLevel(value: unknown, fallback: number): number {
  const numeric =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(
    smartBookmarkFolderLevelBounds.max,
    Math.max(smartBookmarkFolderLevelBounds.min, numeric)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
