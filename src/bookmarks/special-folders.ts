import type { SpecialFolderSettings } from '../settings/settings-repository';
import type { BookmarkRepository } from './ports';
import { isBookmark, type BookmarkNode } from './types';

export type SpecialFolderKind = 'inbox' | 'archive' | 'recycleBin';

export interface SpecialFolderSettingsPort {
  getSpecialFolders(): Promise<SpecialFolderSettings>;
  setSpecialFolders(value: SpecialFolderSettings): Promise<void>;
}

export type SpecialFolderCheck =
  | {
      ok: true;
      kind: SpecialFolderKind;
      folder: BookmarkNode;
    }
  | {
      ok: false;
      kind: SpecialFolderKind;
      code:
        | 'unbound-special-folder'
        | 'missing-special-folder'
        | 'special-folder-is-bookmark';
      folderId?: string;
    };

const settingKey: Record<SpecialFolderKind, keyof SpecialFolderSettings> = {
  inbox: 'inboxId',
  archive: 'archiveId',
  recycleBin: 'recycleBinId'
};

export class SpecialFolderService {
  constructor(
    private readonly bookmarks: BookmarkRepository,
    private readonly settings: SpecialFolderSettingsPort
  ) {}

  async bind(
    kind: SpecialFolderKind,
    folderId: string
  ): Promise<SpecialFolderCheck> {
    const checked = await this.inspect(kind, folderId);
    if (!checked.ok) return checked;
    const current = await this.settings.getSpecialFolders();
    await this.settings.setSpecialFolders({
      ...current,
      [settingKey[kind]]: folderId
    });
    return checked;
  }

  async check(kind: SpecialFolderKind): Promise<SpecialFolderCheck> {
    const configured = await this.settings.getSpecialFolders();
    const folderId = configured[settingKey[kind]];
    if (!folderId) {
      return { ok: false, kind, code: 'unbound-special-folder' };
    }
    return this.inspect(kind, folderId);
  }

  private async inspect(
    kind: SpecialFolderKind,
    folderId: string
  ): Promise<SpecialFolderCheck> {
    const folder = await this.bookmarks.get(folderId);
    if (!folder) {
      return { ok: false, kind, code: 'missing-special-folder', folderId };
    }
    if (isBookmark(folder)) {
      return {
        ok: false,
        kind,
        code: 'special-folder-is-bookmark',
        folderId
      };
    }
    return { ok: true, kind, folder };
  }
}
