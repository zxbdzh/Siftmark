import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ExternalLink } from 'lucide-react';
import type { BookmarkNode } from '../../bookmarks/types';
import { useManagerStore } from './manager-store';

interface BookmarkListProps {
  bookmarks: BookmarkNode[];
  onOpen?(bookmark: BookmarkNode): void;
  onContextMenu?(bookmark: BookmarkNode, position: { x: number; y: number }): void;
}

export function BookmarkList({ bookmarks, onOpen, onContextMenu }: BookmarkListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selected = useManagerStore((state) => state.selectedBookmarkIds);
  const select = useManagerStore((state) => state.selectBookmark);
  const clear = useManagerStore((state) => state.clearSelection);
  const focusedId = useManagerStore((state) => state.focusedBookmarkId);
  const focusBookmark = useManagerStore((state) => state.focusBookmark);
  const density = useManagerStore((state) => state.density);
  const rowHeight = density === 'compact' ? 34 : 44;
  const virtualizer = useVirtualizer({ count: bookmarks.length, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, getItemKey: (index) => bookmarks[index]!.id, overscan: 8, initialRect: { width: 800, height: 600 } });
  const measuredItems = virtualizer.getVirtualItems();
  const items = measuredItems.length > 0 ? measuredItems : bookmarks.slice(0, 20).map((bookmark, index) => ({ key: bookmark.id, index, start: index * rowHeight, size: rowHeight }));
  const ids = bookmarks.map((bookmark) => bookmark.id);
  const activeId = focusedId && ids.includes(focusedId) ? focusedId : bookmarks[0]?.id;
  useEffect(() => {
    if (!focusedId && bookmarks[0]) focusBookmark(bookmarks[0].id);
  }, [bookmarks, focusBookmark, focusedId]);

  const moveFocus = (index: number, extend: boolean) => {
    const bounded = Math.max(0, Math.min(bookmarks.length - 1, index));
    const bookmark = bookmarks[bounded];
    if (!bookmark) return;
    virtualizer.scrollToIndex(bounded, { align: 'auto' });
    select(bookmark.id, false, extend ? ids : undefined);
  };

  return <div ref={parentRef} className="bookmark-scroll" role="group" aria-label="当前文件夹书签" tabIndex={0} onKeyDown={(event) => {
    const current = Math.max(0, ids.indexOf(activeId ?? ''));
    if (event.key === 'Escape') { clear(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(current + 1, event.shiftKey); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(current - 1, event.shiftKey); }
    else if (event.key === 'Home') { event.preventDefault(); moveFocus(0, event.shiftKey); }
    else if (event.key === 'End') { event.preventDefault(); moveFocus(bookmarks.length - 1, event.shiftKey); }
    else if (event.key === 'Enter' && bookmarks[current]) onOpen?.(bookmarks[current]);
    else if ((event.key === 'a' || event.key === 'A') && (event.ctrlKey || event.metaKey)) { event.preventDefault(); useManagerStore.setState({ selectedBookmarkIds: new Set(ids) }); }
  }}><div className="bookmark-virtual" style={{ height: Math.max(virtualizer.getTotalSize(), bookmarks.length * rowHeight) }}>{items.map((item) => { const bookmark = bookmarks[item.index]!; return <button id={`bookmark-row-${bookmark.id}`} key={bookmark.id} className="bookmark-row" aria-pressed={selected.has(bookmark.id)} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-siftmark-bookmark', bookmark.id); }} style={{ height: item.size, transform: `translateY(${item.start}px)` }} onClick={(event) => select(bookmark.id, event.ctrlKey || event.metaKey, event.shiftKey ? ids : undefined)} onDoubleClick={() => onOpen?.(bookmark)} onContextMenu={(event) => { event.preventDefault(); select(bookmark.id); onContextMenu?.(bookmark, { x: event.clientX, y: event.clientY }); }}><span className="bookmark-title">{bookmark.title || bookmark.url}</span><span className="bookmark-domain">{domainOf(bookmark.url)}</span><ExternalLink size={15} aria-hidden="true"/></button>; })}</div></div>;
}

function domainOf(url?: string): string { try { return url ? new URL(url).hostname : ''; } catch { return ''; } }
