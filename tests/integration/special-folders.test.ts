import { describe, expect, it } from 'vitest';
import type { BookmarkRepository } from '../../src/bookmarks/ports';
import type { BookmarkNode } from '../../src/bookmarks/types';
import {
  SpecialFolderService,
  type SpecialFolderSettingsPort
} from '../../src/bookmarks/special-folders';

describe('SpecialFolderService', () => {
  it('keeps a binding healthy when the native folder is renamed or moved', async () => {
    const bookmarks = new MemoryBookmarks([
      { id: 'toolbar', parentId: '0', index: 0, title: 'Bookmarks bar' },
      {
        id: 'archive',
        parentId: 'toolbar',
        index: 0,
        title: 'Siftmark archive'
      }
    ]);
    const settings = new MemorySpecialFolderSettings();
    const service = new SpecialFolderService(bookmarks, settings);

    expect(await service.bind('archive', 'archive')).toMatchObject({
      ok: true,
      folder: { id: 'archive' }
    });

    await bookmarks.update('archive', { title: 'Later' });
    await bookmarks.move('archive', '0', 1);

    expect(await service.check('archive')).toMatchObject({
      ok: true,
      folder: { id: 'archive', parentId: '0', title: 'Later' }
    });
  });

  it('pauses a feature when its bound folder is deleted without recreating it by name', async () => {
    const bookmarks = new MemoryBookmarks([
      { id: 'toolbar', parentId: '0', index: 0, title: 'Bookmarks bar' },
      { id: 'recycle', parentId: 'toolbar', index: 0, title: 'Siftmark 回收站' }
    ]);
    const settings = new MemorySpecialFolderSettings();
    const service = new SpecialFolderService(bookmarks, settings);
    await service.bind('recycleBin', 'recycle');

    await bookmarks.remove('recycle');

    expect(await service.check('recycleBin')).toEqual({
      ok: false,
      kind: 'recycleBin',
      code: 'missing-special-folder',
      folderId: 'recycle'
    });
    expect(await bookmarks.getTree()).toEqual([
      { id: 'toolbar', parentId: '0', index: 0, title: 'Bookmarks bar' }
    ]);
  });
});

class MemorySpecialFolderSettings implements SpecialFolderSettingsPort {
  private value: Record<string, string | undefined> = {};

  async getSpecialFolders() {
    return { ...this.value };
  }

  async setSpecialFolders(value: Record<string, string | undefined>) {
    this.value = { ...value };
  }
}

class MemoryBookmarks implements BookmarkRepository {
  private readonly nodes = new Map<string, BookmarkNode>();

  constructor(nodes: BookmarkNode[]) {
    for (const node of nodes) this.nodes.set(node.id, { ...node });
  }

  async get(id: string) {
    return this.nodes.get(id) ?? null;
  }

  async getTree() {
    return [...this.nodes.values()];
  }

  async create(input: Omit<BookmarkNode, 'id'>) {
    const node = { ...input, id: `created-${this.nodes.size}` };
    this.nodes.set(node.id, node);
    return node;
  }

  async update(id: string, patch: Pick<BookmarkNode, 'title'>) {
    const node = this.require(id);
    const updated = { ...node, ...patch };
    this.nodes.set(id, updated);
    return updated;
  }

  async move(id: string, parentId: string, index = 0) {
    const node = this.require(id);
    const moved = { ...node, parentId, index };
    this.nodes.set(id, moved);
    return moved;
  }

  async remove(id: string) {
    this.nodes.delete(id);
  }

  private require(id: string) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Missing bookmark ${id}`);
    return node;
  }
}
