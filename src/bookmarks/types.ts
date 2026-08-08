export type BookmarkId = string;

export interface BookmarkNode {
  id: BookmarkId;
  parentId: BookmarkId;
  index: number;
  title: string;
  url?: string;
  dateAdded?: number;
}

export function isBookmark(node: BookmarkNode): node is BookmarkNode & { url: string } {
  return typeof node.url === 'string' && node.url.length > 0;
}
