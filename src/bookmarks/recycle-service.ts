import type { BookmarkCommandService } from '../operations/bookmark-command-service';
import type { OperationError, OperationRecord } from '../operations/types';
import type { BookmarkRepository } from './ports';
import type { SpecialFolderService } from './special-folders';
import { isBookmark, type BookmarkNode } from './types';

export type SpecialFolderPlacementState = 'recycled' | 'archived';

export interface SpecialFolderPlacement {
  bookmarkId: string;
  state: SpecialFolderPlacementState;
  originalParentId: string;
  originalIndex: number;
  destinationFolderId: string;
  movedAt: number;
}

export interface SpecialFolderPlacementRepository {
  get(bookmarkId: string): Promise<SpecialFolderPlacement | null>;
  list(): Promise<SpecialFolderPlacement[]>;
  put(value: SpecialFolderPlacement): Promise<void>;
  delete(bookmarkId: string): Promise<void>;
  listRecycledBefore(cutoff: number): Promise<SpecialFolderPlacement[]>;
}

export type SpecialFolderActionError =
  | OperationError
  | {
      code:
        | 'unbound-special-folder'
        | 'missing-special-folder'
        | 'special-folder-is-bookmark'
        | 'placement-not-found'
        | 'destination-required'
        | 'invalid-destination';
      folderId?: string;
      originalParentId?: string;
    };

export type SpecialFolderActionResult =
  | {
      ok: true;
      operation: OperationRecord;
      destination: BookmarkNode;
      originalLocation: { parentId: string; index: number };
    }
  | { ok: false; error: SpecialFolderActionError };

export class RecycleService {
  constructor(
    private readonly bookmarks: BookmarkRepository,
    private readonly commands: BookmarkCommandService,
    private readonly specialFolders: SpecialFolderService,
    private readonly placements: SpecialFolderPlacementRepository,
    private readonly now: () => number = Date.now
  ) {}

  async recycle(bookmarkId: string): Promise<SpecialFolderActionResult> {
    const destination = await this.specialFolders.check('recycleBin');
    if (!destination.ok) {
      return {
        ok: false,
        error: {
          code: destination.code,
          ...(destination.folderId ? { folderId: destination.folderId } : {})
        }
      };
    }
    const bookmark = await this.bookmarks.get(bookmarkId);
    if (!bookmark) {
      return { ok: false, error: { code: 'not_found', id: bookmarkId } };
    }
    const originalLocation = {
      parentId: bookmark.parentId,
      index: bookmark.index
    };
    const previousPlacement = await this.placements.get(bookmarkId);
    const placement: SpecialFolderPlacement = {
      bookmarkId,
      state: 'recycled',
      originalParentId: bookmark.parentId,
      originalIndex: bookmark.index,
      destinationFolderId: destination.folder.id,
      movedAt: this.now()
    };
    await this.placements.put(placement);
    const moved = await this.commands.move({
      bookmarkId,
      parentId: destination.folder.id,
      expected: originalLocation,
      specialFolderPlacement: {
        before: previousPlacement,
        after: placement
      }
    });
    if (!moved.ok) {
      await this.placements.delete(bookmarkId);
      return moved;
    }
    return {
      ok: true,
      operation: moved.value,
      destination: destination.folder,
      originalLocation
    };
  }

  async restore(
    bookmarkId: string,
    selectedDestinationId?: string
  ): Promise<SpecialFolderActionResult> {
    const placement = await this.placements.get(bookmarkId);
    if (!placement || placement.state !== 'recycled') {
      return { ok: false, error: { code: 'placement-not-found' } };
    }
    const bookmark = await this.bookmarks.get(bookmarkId);
    if (!bookmark) {
      return { ok: false, error: { code: 'not_found', id: bookmarkId } };
    }
    const originalParent = await this.bookmarks.get(placement.originalParentId);
    const destinationId =
      originalParent && !isBookmark(originalParent)
        ? originalParent.id
        : selectedDestinationId;
    if (!destinationId) {
      return {
        ok: false,
        error: {
          code: 'destination-required',
          originalParentId: placement.originalParentId
        }
      };
    }
    const destination = await this.bookmarks.get(destinationId);
    if (!destination || isBookmark(destination)) {
      return {
        ok: false,
        error: { code: 'invalid-destination', folderId: destinationId }
      };
    }
    const moved = await this.commands.move({
      bookmarkId,
      parentId: destination.id,
      ...(destination.id === placement.originalParentId
        ? { index: placement.originalIndex }
        : {}),
      expected: { parentId: bookmark.parentId, index: bookmark.index },
      specialFolderPlacement: { before: placement, after: null }
    });
    if (!moved.ok) return moved;
    await this.placements.delete(bookmarkId);
    return {
      ok: true,
      operation: moved.value,
      destination,
      originalLocation: {
        parentId: placement.originalParentId,
        index: placement.originalIndex
      }
    };
  }
}
