import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkId, BookmarkNode } from '../../bookmarks/types';
import {
  toBookmarkNode,
  type ChromeBookmarkApi,
  type ChromeBookmarkTreeNode
} from './chrome-types';

function flatten(
  nodes: ChromeBookmarkTreeNode[],
  output: BookmarkNode[] = []
): BookmarkNode[] {
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
      const nodes = await this.api.get(id);
      return nodes[0] ? toBookmarkNode(nodes[0]) : null;
    } catch (error) {
      if (isMissingBookmarkError(error)) return null;
      throw error;
    }
  }

  async getTree(): Promise<BookmarkNode[]> {
    return flatten(await this.api.getTree());
  }

  async create(input: Omit<BookmarkNode, 'id'>): Promise<BookmarkNode> {
    const node = await this.api.create({
      parentId: input.parentId,
      index: input.index,
      title: input.title,
      ...(input.url ? { url: input.url } : {})
    });
    return toBookmarkNode(node);
  }

  async update(
    id: BookmarkId,
    patch: Pick<BookmarkNode, 'title' | 'url'>
  ): Promise<BookmarkNode> {
    return toBookmarkNode(await this.api.update(id, { title: patch.title, ...(patch.url !== undefined ? { url: patch.url } : {}) }));
  }

  async move(
    id: BookmarkId,
    parentId: BookmarkId,
    index?: number
  ): Promise<BookmarkNode> {
    const node = await this.api.move(id, {
      parentId,
      ...(index === undefined ? {} : { index })
    });
    return toBookmarkNode(node);
  }

  async remove(id: BookmarkId): Promise<void> {
    await this.api.remove(id);
  }
}

function isMissingBookmarkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /not found|does not exist|no bookmark|can't find bookmark/i.test(
      error.message
    )
  );
}
