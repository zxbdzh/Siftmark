import type { BookmarkNode } from '../../bookmarks/types';

export interface ChromeBookmarkTreeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded?: number;
  children?: ChromeBookmarkTreeNode[];
}

export interface ChromeBookmarkApi {
  get(id: string, callback?: (nodes: ChromeBookmarkTreeNode[]) => void): Promise<ChromeBookmarkTreeNode[]> | void;
  getTree(callback?: (nodes: ChromeBookmarkTreeNode[]) => void): Promise<ChromeBookmarkTreeNode[]> | void;
  create(details: { parentId: string; index?: number; title: string; url?: string }, callback?: (node: ChromeBookmarkTreeNode) => void): Promise<ChromeBookmarkTreeNode> | void;
  update(id: string, changes: { title?: string }, callback?: (node: ChromeBookmarkTreeNode) => void): Promise<ChromeBookmarkTreeNode> | void;
  move(id: string, destination: { parentId: string; index?: number }, callback?: (node: ChromeBookmarkTreeNode) => void): Promise<ChromeBookmarkTreeNode> | void;
  remove(id: string, callback?: () => void): Promise<void> | void;
  onCreated: ChromeEvent<[string, ChromeBookmarkTreeNode]>;
  onChanged: ChromeEvent<[string, { title?: string; url?: string }] >;
  onMoved: ChromeEvent<[string, { parentId: string; index: number; oldParentId: string; oldIndex: number }] >;
  onRemoved: ChromeEvent<[string, { parentId: string; index: number; node: ChromeBookmarkTreeNode }] >;
}

export interface ChromeEvent<TArgs extends unknown[]> {
  addListener(listener: (...args: TArgs) => void): void;
  removeListener(listener: (...args: TArgs) => void): void;
}

export function toBookmarkNode(node: ChromeBookmarkTreeNode): BookmarkNode {
  return {
    id: node.id,
    parentId: node.parentId ?? '',
    index: node.index ?? 0,
    title: node.title,
    ...(node.url ? { url: node.url } : {}),
    dateAdded: node.dateAdded
  };
}
