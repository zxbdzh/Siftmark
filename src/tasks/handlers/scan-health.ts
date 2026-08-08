import type { BookmarkNode } from '../../bookmarks/types';
import type { HealthScanService } from '../../health/health-scan-service';
import type { TaskHandler } from '../types';

export interface ScanHealthInput { folderId?: string }

export function createScanHealthHandler(service: HealthScanService, loadNodes: () => Promise<BookmarkNode[]>): TaskHandler<ScanHealthInput> {
  return async ({ task, signal, reportProgress }) => {
    const nodes = await loadNodes();
    const scoped = task.input.folderId ? nodesInFolder(nodes, task.input.folderId) : nodes;
    if (signal.aborted) return { state: 'cancelled' };
    const result = await service.scan(scoped, signal);
    const completed = result.links.length;
    await reportProgress({ completed, failed: 0 });
    return { state: 'succeeded', completed };
  };
}

function nodesInFolder(nodes: BookmarkNode[], rootId: string): BookmarkNode[] {
  const folderIds = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (!node.url && folderIds.has(node.parentId) && !folderIds.has(node.id)) { folderIds.add(node.id); changed = true; }
  }
  return nodes.filter((node) => folderIds.has(node.id) || folderIds.has(node.parentId));
}
