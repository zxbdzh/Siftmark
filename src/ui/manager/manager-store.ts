import { create } from 'zustand';
import type { BookmarkId } from '../../bookmarks/types';
import type { BookmarkSort } from '../../settings/settings-repository';

export interface ManagerViewState {
  selectedFolderId: BookmarkId | null;
  selectedBookmarkIds: Set<BookmarkId>;
  detailBookmarkId: BookmarkId | null;
  focusedBookmarkId: BookmarkId | null;
  selectionAnchorId: BookmarkId | null;
  density: 'comfortable' | 'compact';
  sort: BookmarkSort;
  selectFolder(id: BookmarkId): void;
  selectBookmark(id: BookmarkId, additive?: boolean, rangeOrder?: BookmarkId[]): void;
  focusBookmark(id: BookmarkId): void;
  setSort(sort: BookmarkSort): void;
  clearSelection(): void;
}

export const useManagerStore = create<ManagerViewState>((set) => ({
  selectedFolderId: null,
  selectedBookmarkIds: new Set(),
  detailBookmarkId: null,
  focusedBookmarkId: null,
  selectionAnchorId: null,
  density: 'comfortable',
  sort: { field: 'manual', direction: 'asc' },
  selectFolder: (id) => set({ selectedFolderId: id, selectedBookmarkIds: new Set(), detailBookmarkId: null, focusedBookmarkId: null, selectionAnchorId: null }),
  selectBookmark: (id, additive = false, rangeOrder) => set((state) => {
    if (rangeOrder && state.selectionAnchorId) {
      const start = rangeOrder.indexOf(state.selectionAnchorId);
      const end = rangeOrder.indexOf(id);
      if (start >= 0 && end >= 0) {
        const range = rangeOrder.slice(Math.min(start, end), Math.max(start, end) + 1);
        return { selectedBookmarkIds: new Set(range), detailBookmarkId: id, focusedBookmarkId: id };
      }
    }
    const next = additive ? new Set(state.selectedBookmarkIds) : new Set<BookmarkId>();
    if (additive && next.has(id)) next.delete(id);
    else next.add(id);
    return { selectedBookmarkIds: next, detailBookmarkId: id, focusedBookmarkId: id, selectionAnchorId: id };
  }),
  focusBookmark: (id) => set({ focusedBookmarkId: id }),
  setSort: (sort) => set({ sort }),
  clearSelection: () => set({ selectedBookmarkIds: new Set(), detailBookmarkId: null, focusedBookmarkId: null, selectionAnchorId: null })
}));
