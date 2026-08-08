import { useState } from 'react';
import { Menu, PanelRight } from 'lucide-react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkNode } from '../../bookmarks/types';
import { isBookmark } from '../../bookmarks/types';
import { BookmarkList } from './BookmarkList';
import { DetailPanel } from './DetailPanel';
import { FolderTree } from './FolderTree';
import { ResponsiveDrawer } from './ResponsiveDrawer';
import { useManagerStore } from './manager-store';

export function ManagerLayout({ nodes, loading, repository }: { nodes: BookmarkNode[]; loading: boolean; repository: BookmarkRepository }) {
  const [drawer, setDrawer] = useState<'folders' | 'detail' | null>(null);
  const folderId = useManagerStore((state) => state.selectedFolderId);
  const detailId = useManagerStore((state) => state.detailBookmarkId);
  const folders = nodes.filter((node) => !isBookmark(node));
  const bookmarks = nodes.filter((node) => isBookmark(node) && (!folderId || node.parentId === folderId));
  const detail = nodes.find((node) => node.id === detailId);
  return <div className="manager-shell"><header className="manager-header"><strong className="brand-type">Siftmark</strong><nav aria-label="管理器视图"><button type="button" onClick={() => setDrawer('folders')} aria-label="打开文件夹"><Menu size={18}/></button><button type="button" onClick={() => setDrawer('detail')} aria-label="打开详情"><PanelRight size={18}/></button></nav></header><aside className="manager-folders" aria-label="文件夹"><FolderTree folders={folders}/></aside><main className="manager-list" aria-label="书签列表">{loading ? <p className="empty-state">正在读取书签…</p> : bookmarks.length ? <BookmarkList bookmarks={bookmarks}/> : <p className="empty-state">此文件夹暂无书签</p>}</main><aside className="manager-detail" aria-label="书签详情"><DetailPanel bookmark={detail} repository={repository}/></aside><ResponsiveDrawer open={drawer === 'folders'} label="文件夹" onClose={() => setDrawer(null)}><FolderTree folders={folders}/></ResponsiveDrawer><ResponsiveDrawer open={drawer === 'detail'} label="书签详情" onClose={() => setDrawer(null)}><DetailPanel bookmark={detail} repository={repository}/></ResponsiveDrawer></div>;
}
