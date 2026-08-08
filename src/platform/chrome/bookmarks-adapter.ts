import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkId, BookmarkNode } from '../../bookmarks/types';
import { toBookmarkNode, type ChromeBookmarkApi, type ChromeBookmarkTreeNode } from './chrome-types';

export function callChrome<T>(operation: (callback: (value: T) => void) => Promise<T> | void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const result = operation((value) => {
        const runtimeError = (globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome?.runtime?.lastError;
        if (runtimeError) {
          settled = true;
          reject(new Error(runtimeError.message ?? 'Chrome API error'));
          return;
        }
        finish(value);
      });
      if (result && typeof (result as Promise<T>).then === 'function') {
        void (result as Promise<T>).then(finish, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function flatten(nodes: ChromeBookmarkTreeNode[], output: BookmarkNode[] = []): BookmarkNode[] {
  for (const node of nodes) {
    output.push(toBookmarkNode(node));
    if (node.children) flatten(node.children, output);
  }
  return output;
}

export class ChromeBookmarkRepository implements BookmarkRepository {
  constructor(private readonly api: ChromeBookmarkApi) {}

  async get(id: BookmarkId): Promise<BookmarkNode | null> {
    try {
      const nodes = await callChrome<ChromeBookmarkTreeNode[]>((callback) => this.api.get(id, callback));
      return nodes[0] ? toBookmarkNode(nodes[0]) : null;
    } catch (error) {
      if (isMissingBookmarkError(error)) return null;
      throw error;
    }
  }

  async getTree(): Promise<BookmarkNode[]> {
    return flatten(await callChrome<ChromeBookmarkTreeNode[]>((callback) => this.api.getTree(callback)));
  }

  async create(input: Omit<BookmarkNode, 'id'>): Promise<BookmarkNode> {
    const node = await callChrome<ChromeBookmarkTreeNode>((callback) => this.api.create({ parentId: input.parentId, index: input.index, title: input.title, ...(input.url ? { url: input.url } : {}) }, callback));
    return toBookmarkNode(node);
  }

  async update(id: BookmarkId, patch: Pick<BookmarkNode, 'title'>): Promise<BookmarkNode> {
    return toBookmarkNode(await callChrome<ChromeBookmarkTreeNode>((callback) => this.api.update(id, { title: patch.title }, callback)));
  }

  async move(id: BookmarkId, parentId: BookmarkId, index?: number): Promise<BookmarkNode> {
    const nodes = await callChrome<ChromeBookmarkTreeNode[]>((callback) => this.api.move(id, { parentId, ...(index === undefined ? {} : { index }) }, callback));
    const node = nodes[0];
    if (!node) throw new Error('Chrome bookmark move returned no node');
    return toBookmarkNode(node);
  }

  async remove(id: BookmarkId): Promise<void> {
    await callChrome<void>((callback) => this.api.remove(id, callback));
  }
}

function isMissingBookmarkError(error: unknown): boolean {
  return error instanceof Error && /not found|does not exist|no bookmark/i.test(error.message);
}
