import type { BookmarkId, BookmarkNode } from './types';

export interface BookmarkRepository {
  get(id: BookmarkId): Promise<BookmarkNode | null>;
  getTree(): Promise<BookmarkNode[]>;
  create(input: Omit<BookmarkNode, 'id'>): Promise<BookmarkNode>;
  update(id: BookmarkId, patch: Pick<BookmarkNode, 'title'>): Promise<BookmarkNode>;
  move(id: BookmarkId, parentId: BookmarkId, index?: number): Promise<BookmarkNode>;
  remove(id: BookmarkId): Promise<void>;
}
