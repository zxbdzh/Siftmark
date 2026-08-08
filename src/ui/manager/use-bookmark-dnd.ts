import type { BookmarkCommandService } from '../../operations/bookmark-command-service';
import type { BookmarkNode } from '../../bookmarks/types';
export function createBookmarkMoveHandler(commands: BookmarkCommandService) { return (bookmark: BookmarkNode, parentId: string) => commands.move({ bookmarkId: bookmark.id, parentId, expected: { parentId: bookmark.parentId, index: bookmark.index } }); }
