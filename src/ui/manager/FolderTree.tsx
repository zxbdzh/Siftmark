import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Folder } from 'lucide-react';
import type { BookmarkNode } from '../../bookmarks/types';
import { useManagerStore } from './manager-store';

export function FolderTree({ folders, onDropBookmark, onContextMenu }: { folders: BookmarkNode[]; onDropBookmark?(bookmarkId: string, folderId: string): void; onContextMenu?(folder: BookmarkNode, position: { x: number; y: number }): void }) {
  const selected = useManagerStore((state) => state.selectedFolderId);
  const select = useManagerStore((state) => state.selectFolder);
  const [focused, setFocused] = useState(0);
  const [dropTargetId, setDropTargetId] = useState<string>();
  const parentRef = useRef<HTMLDivElement>(null);
  const depths = useMemo(() => calculateDepths(folders), [folders]);
  const virtualizer = useVirtualizer({ count: folders.length, getScrollElement: () => parentRef.current, estimateSize: () => 36, getItemKey: (index) => folders[index]!.id, overscan: 8, initialRect: { width: 240, height: 700 } });
  const measured = virtualizer.getVirtualItems();
  const items = measured.length > 0 ? measured : folders.slice(0, 30).map((folder, index) => ({ key: folder.id, index, start: index * 36, size: 36 }));
  const focusIndex = (index: number) => {
    const next = Math.max(0, Math.min(folders.length - 1, index));
    setFocused(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
    const folder = folders[next];
    if (folder) select(folder.id);
  };
  return <div ref={parentRef} className="folder-tree-scroll" role="tree" aria-label="书签文件夹" onKeyDown={(event) => {
    if (event.key === 'ArrowDown') focusIndex(focused + 1);
    else if (event.key === 'ArrowUp') focusIndex(focused - 1);
    else if (event.key === 'Home') focusIndex(0);
    else if (event.key === 'End') focusIndex(folders.length - 1);
    else return;
    event.preventDefault();
  }}><div className="folder-tree" style={{ height: Math.max(virtualizer.getTotalSize(), folders.length * 36) }}>{items.map((item) => { const folder = folders[item.index]!; const isDropTarget = dropTargetId === folder.id; return <button className="tree-row" data-drop-target={isDropTarget || undefined} aria-label={isDropTarget ? `移动到 ${folder.title || '书签'}` : undefined} role="treeitem" aria-level={(depths.get(folder.id) ?? 0) + 1} aria-selected={selected === folder.id} tabIndex={item.index === focused ? 0 : -1} key={folder.id} style={{ height: item.size, transform: `translateY(${item.start}px)`, paddingInlineStart: 10 + (depths.get(folder.id) ?? 0) * 14 }} onFocus={() => setFocused(item.index)} onClick={() => select(folder.id)} onContextMenu={(event) => { event.preventDefault(); select(folder.id); onContextMenu?.(folder, { x: event.clientX, y: event.clientY }); }} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-siftmark-bookmark')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTargetId(folder.id); } }} onDragLeave={() => setDropTargetId((current) => current === folder.id ? undefined : current)} onDrop={(event) => { event.preventDefault(); setDropTargetId(undefined); const bookmarkId = event.dataTransfer.getData('application/x-siftmark-bookmark'); if (bookmarkId) onDropBookmark?.(bookmarkId, folder.id); }}><Folder size={16} aria-hidden="true"/><span>{folder.title || '书签'}</span>{isDropTarget ? <span className="drop-target-label" aria-hidden="true">移动到</span> : null}</button>; })}</div></div>;
}

function calculateDepths(folders: BookmarkNode[]): Map<string, number> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depths = new Map<string, number>();
  const depthOf = (folder: BookmarkNode, seen = new Set<string>()): number => {
    const cached = depths.get(folder.id);
    if (cached !== undefined) return cached;
    if (!folder.parentId || seen.has(folder.id)) return 0;
    const parent = byId.get(folder.parentId);
    if (!parent) return 0;
    seen.add(folder.id);
    const depth = depthOf(parent, seen) + 1;
    depths.set(folder.id, depth);
    return depth;
  };
  for (const folder of folders) depths.set(folder.id, depthOf(folder));
  return depths;
}
