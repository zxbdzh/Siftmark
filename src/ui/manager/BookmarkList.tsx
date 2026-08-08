import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ExternalLink } from 'lucide-react';
import type { BookmarkNode } from '../../bookmarks/types';
import { useManagerStore } from './manager-store';

export function BookmarkList({ bookmarks }: { bookmarks: BookmarkNode[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selected = useManagerStore((state) => state.selectedBookmarkIds);
  const select = useManagerStore((state) => state.selectBookmark);
  const clear = useManagerStore((state) => state.clearSelection);
  const density = useManagerStore((state) => state.density);
  const rowHeight = density === 'compact' ? 34 : 44;
  const virtualizer = useVirtualizer({ count: bookmarks.length, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, getItemKey: (index) => bookmarks[index]!.id, overscan: 8, initialRect: { width: 800, height: 600 } });
  const measuredItems = virtualizer.getVirtualItems();
  const items = measuredItems.length > 0 ? measuredItems : bookmarks.slice(0, 20).map((bookmark, index) => ({ key: bookmark.id, index, start: index * rowHeight, size: rowHeight }));
  return <div ref={parentRef} className="bookmark-scroll" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Escape') clear(); }}><div className="bookmark-virtual" style={{ height: virtualizer.getTotalSize() }}>{items.map((item) => { const bookmark = bookmarks[item.index]!; return <button key={bookmark.id} className="bookmark-row" aria-pressed={selected.has(bookmark.id)} style={{ height: item.size, transform: `translateY(${item.start}px)` }} onClick={(event) => select(bookmark.id, event.ctrlKey || event.metaKey)}><span className="bookmark-title">{bookmark.title || bookmark.url}</span><span className="bookmark-domain">{domainOf(bookmark.url)}</span><ExternalLink size={15} aria-hidden="true"/></button>; })}</div></div>;
}

function domainOf(url?: string): string { try { return url ? new URL(url).hostname : ''; } catch { return ''; } }
