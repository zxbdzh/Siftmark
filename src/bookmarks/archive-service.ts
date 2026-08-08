import type { BookmarkCommandService } from '../operations/bookmark-command-service';
import type { BookmarkRepository } from './ports';
import type {
  SpecialFolderActionResult,
  SpecialFolderPlacementRepository
} from './recycle-service';
import type { SpecialFolderService } from './special-folders';
import { isBookmark } from './types';

export class ArchiveService {
  constructor(
    private readonly bookmarks: BookmarkRepository,
    private readonly commands: BookmarkCommandService,
    private readonly specialFolders: SpecialFolderService,
    private readonly placements: SpecialFolderPlacementRepository,
    private readonly now: () => number = Date.now
  ) {}

  async archive(bookmarkId: string): Promise<SpecialFolderActionResult> {
    const destination = await this.specialFolders.check('archive');
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
    const placement = {
      bookmarkId,
      state: 'archived' as const,
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
    if (!placement || placement.state !== 'archived') {
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
