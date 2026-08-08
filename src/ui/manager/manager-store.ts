import { create } from 'zustand';
import type { BookmarkId } from '../../bookmarks/types';

export interface ManagerViewState {
  selectedFolderId: BookmarkId | null;
  selectedBookmarkIds: Set<BookmarkId>;
  detailBookmarkId: BookmarkId | null;
  density: 'comfortable' | 'compact';
  sort: { field: 'manual' | 'title' | 'domain' | 'createdAt' | 'updatedAt' | 'visitedAt' | 'health' | 'confidence'; direction: 'asc' | 'desc' };
  selectFolder(id: BookmarkId): void;
  selectBookmark(id: BookmarkId, additive?: boolean): void;
  clearSelection(): void;
}

export const useManagerStore = create<ManagerViewState>((set) => ({
  selectedFolderId: null,
  selectedBookmarkIds: new Set(),
  detailBookmarkId: null,
  density: 'comfortable',
  sort: { field: 'manual', direction: 'asc' },
  selectFolder: (id) => set({ selectedFolderId: id, selectedBookmarkIds: new Set(), detailBookmarkId: null }),
  selectBookmark: (id, additive = false) => set((state) => ({ selectedBookmarkIds: additive ? new Set(state.selectedBookmarkIds).add(id) : new Set([id]), detailBookmarkId: id })),
  clearSelection: () => set({ selectedBookmarkIds: new Set(), detailBookmarkId: null })
}));
