import type { BookmarkRepository } from '../../bookmarks/ports';
import type { SpecialFolderPlacementRepository } from '../../bookmarks/recycle-service';
import type { SpecialFolderService } from '../../bookmarks/special-folders';
import type { BookmarkNode } from '../../bookmarks/types';
import type { MetadataRepository } from '../../storage/types';
import type { TaskHandler } from '../types';

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface PurgeRecycleBinDependencies {
  bookmarks: BookmarkRepository;
  placements: SpecialFolderPlacementRepository;
  specialFolders: SpecialFolderService;
  metadata: MetadataRepository;
  now?: () => number;
  retentionMs?: number;
}

export function createPurgeRecycleBinHandler({
  bookmarks,
  placements,
  specialFolders,
  metadata,
  now = Date.now,
  retentionMs = DEFAULT_RETENTION_MS
}: PurgeRecycleBinDependencies): TaskHandler<Record<string, never>> {
  return async ({ signal, reportProgress }) => {
    const recycleBin = await specialFolders.check('recycleBin');
    if (!recycleBin.ok) return { state: 'paused' };

    const currentTime = now();
    const expired = await placements.listRecycledBefore(
      currentTime - retentionMs
    );
    const tree = await bookmarks.getTree();
    let completed = 0;
    let failed = 0;

    for (const placement of expired) {
      if (signal.aborted) {
        return { state: 'cancelled', completed, failed };
      }
      const item = await bookmarks.get(placement.bookmarkId);
      if (!item) {
        await placements.delete(placement.bookmarkId);
        completed += 1;
        await reportProgress({ completed, failed });
        continue;
      }
      if (item.parentId !== recycleBin.folder.id) {
        await placements.delete(placement.bookmarkId);
        await reportProgress({ completed, failed });
        continue;
      }
      try {
        const subtree = subtreeRemovalOrder(tree, item.id);
        for (const node of subtree) {
          await bookmarks.remove(node.id);
          await metadata.softDelete(node.id, currentTime);
          await placements.delete(node.id);
        }
        completed += 1;
      } catch {
        failed += 1;
      }
      await reportProgress({ completed, failed });
    }

    return {
      state: failed > 0 ? 'paused' : 'succeeded',
      completed,
      failed
    };
  };
}

function subtreeRemovalOrder(
  nodes: BookmarkNode[],
  rootId: string
): BookmarkNode[] {
  const children = new Map<string, BookmarkNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const result: BookmarkNode[] = [];
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) visit(child.id);
    const node = nodes.find((candidate) => candidate.id === id);
    if (node) result.push(node);
  };
  visit(rootId);
  return result;
}
