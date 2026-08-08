import { isBookmark, type BookmarkNode } from '../bookmarks/types';
import type { BookmarkMetadata } from '../storage/types';
import type { SearchDocument } from './types';

export function buildSearchDocuments(
  nodes: BookmarkNode[],
  metadataById: Map<string, BookmarkMetadata>,
  visitsById: Map<string, number>
): SearchDocument[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter(isBookmark).map((bookmark) => {
    const metadata = metadataById.get(bookmark.id);
    return {
      bookmarkId: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      folderId: bookmark.parentId,
      folderPath: folderPathOf(bookmark.parentId, nodesById),
      tags: metadata?.tags ?? [],
      summary: metadata?.summary ?? '',
      note: metadata?.note ?? '',
      health: metadata?.health ?? 'unchecked',
      confidence: metadata?.confidence ?? 'unknown',
      createdAt: bookmark.dateAdded ?? 0,
      updatedAt: metadata?.updatedAt ?? bookmark.dateAdded ?? 0,
      lastVisitedAt: visitsById.get(bookmark.id)
    };
  });
}

function folderPathOf(folderId: string, nodesById: Map<string, BookmarkNode>): string {
  const segments: string[] = [];
  const visited = new Set<string>();
  let current = nodesById.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.title.trim()) segments.unshift(current.title.trim());
    current = nodesById.get(current.parentId);
  }
  return segments.join(' / ');
}
