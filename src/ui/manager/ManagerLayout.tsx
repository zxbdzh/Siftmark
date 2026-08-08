import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Menu, PanelRight } from 'lucide-react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkNode } from '../../bookmarks/types';
import { isBookmark } from '../../bookmarks/types';
import { BookmarkList } from './BookmarkList';
import { DetailPanel } from './DetailPanel';
import { FolderTree } from './FolderTree';
import { ResponsiveDrawer } from './ResponsiveDrawer';
import { useManagerStore } from './manager-store';
import type { BookmarkCommandService } from '../../operations/bookmark-command-service';
import { BookmarkContextMenu } from './BookmarkContextMenu';
import { MoveBookmarkDialog } from './MoveBookmarkDialog';
import type { MetadataRepository } from '../../storage/types';
import type { BookmarkMetadata } from '../../storage/types';
import type { BookmarkSort } from '../../settings/settings-repository';
import { FolderContextMenu } from './FolderContextMenu';

interface ManagerLayoutProps {
  nodes: BookmarkNode[];
  loading: boolean;
  repository: BookmarkRepository;
  commands?: BookmarkCommandService;
  recycleBinId?: string;
  onRefresh?(): Promise<void> | void;
  onAnalyze?(bookmark: BookmarkNode): void;
  onHealthScan?(folder: BookmarkNode): void;
  reviewWorkspace?: ReactNode;
  metadataRepository?: MetadataRepository;
  metadataById?: Map<string, BookmarkMetadata>;
  visitsById?: Map<string, number>;
  sortRepository?: { getFolderSort(folderId: string): Promise<BookmarkSort>; setFolderSort(folderId: string, sort: BookmarkSort): Promise<void> };
  draftWorkspace?: ReactNode;
}

export function ManagerLayout({ nodes, loading, repository, commands, recycleBinId, onRefresh, onAnalyze, onHealthScan, reviewWorkspace, metadataRepository, metadataById = new Map(), visitsById = new Map(), sortRepository, draftWorkspace }: ManagerLayoutProps) {
  const [drawer, setDrawer] = useState<'folders' | 'detail' | null>(null);
  const [view, setView] = useState<'bookmarks' | 'review' | 'drafts'>('bookmarks');
  const [moving, setMoving] = useState<BookmarkNode>();
  const [context, setContext] = useState<({ kind: 'bookmark'; bookmark: BookmarkNode } | { kind: 'folder'; folder: BookmarkNode }) & { x: number; y: number }>();
  const folderId = useManagerStore((state) => state.selectedFolderId);
  const detailId = useManagerStore((state) => state.detailBookmarkId);
  const sort = useManagerStore((state) => state.sort);
  const setSort = useManagerStore((state) => state.setSort);
  const folders = nodes.filter((node) => !isBookmark(node));
  const bookmarks = useMemo(() => sortBookmarks(nodes.filter((node) => isBookmark(node) && (!folderId || node.parentId === folderId)), sort, metadataById, visitsById), [folderId, metadataById, nodes, sort, visitsById]);
  const detail = nodes.find((node) => node.id === detailId);
  const sortFolderId = folderId ?? '__all__';
  useEffect(() => { let active = true; if (sortRepository) void sortRepository.getFolderSort(sortFolderId).then((value) => { if (active) setSort(value); }); return () => { active = false; }; }, [setSort, sortFolderId, sortRepository]);
  const updateSort = (next: BookmarkSort) => { setSort(next); void sortRepository?.setFolderSort(sortFolderId, next); };
  const moveBookmark = async (bookmarkId: string, destinationId: string) => {
    const bookmark = nodes.find((node) => node.id === bookmarkId);
    if (!bookmark || !commands || bookmark.parentId === destinationId) return;
    const result = await commands.move({ bookmarkId, parentId: destinationId, expected: { parentId: bookmark.parentId, index: bookmark.index } });
    if (!result.ok) globalThis.alert?.('书签已在其他位置发生变化，请刷新后重试。');
    setMoving(undefined);
    setContext(undefined);
    await onRefresh?.();
  };
  const openBookmark = (bookmark: BookmarkNode) => { if (bookmark.url) void browser.tabs.create({ url: bookmark.url }); };
  const exportBookmark = (bookmark: BookmarkNode) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, bookmark }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `siftmark-${bookmark.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const createChildFolder = async (parent: BookmarkNode) => {
    const title = globalThis.prompt?.('输入新文件夹名称')?.trim();
    if (!title) return;
    await repository.create({ parentId: parent.id, index: 0, title });
    setContext(undefined);
    await onRefresh?.();
  };
  const showContext = (bookmark: BookmarkNode, position: { x: number; y: number }) => setContext({ kind: 'bookmark', bookmark, ...position });
  const showFolderContext = (folder: BookmarkNode, position: { x: number; y: number }) => setContext({ kind: 'folder', folder, ...position });
  const folderTree = <FolderTree folders={folders} onDropBookmark={(bookmarkId, folderId) => void moveBookmark(bookmarkId, folderId)} onContextMenu={showFolderContext}/>;
  const mainLabel = view === 'review' ? '审核工作区' : view === 'drafts' ? '笔记草稿' : '书签列表';
  return <div className="manager-shell" onClick={() => setContext(undefined)}><header className="manager-header"><strong className="brand-type">Siftmark</strong><div className="manager-view-switch" role="tablist" aria-label="管理器工作区"><button type="button" role="tab" aria-selected={view === 'bookmarks'} onClick={() => setView('bookmarks')}>书签</button><button type="button" role="tab" aria-selected={view === 'review'} onClick={() => setView('review')}>审核</button><button type="button" role="tab" aria-selected={view === 'drafts'} onClick={() => setView('drafts')}>草稿</button></div><nav aria-label="管理器视图"><button type="button" onClick={() => setDrawer('folders')} aria-label="打开文件夹"><Menu size={18}/></button><button type="button" onClick={() => setDrawer('detail')} aria-label="打开详情"><PanelRight size={18}/></button></nav></header><aside className="manager-folders" aria-label="文件夹">{folderTree}</aside><main className="manager-list" aria-label={mainLabel}>{view === 'review' ? reviewWorkspace ?? <p className="empty-state">暂无审核项目</p> : view === 'drafts' ? draftWorkspace ?? <p className="empty-state">暂无笔记草稿</p> : <><div className="bookmark-toolbar"><label>排序<select aria-label="排序字段" value={sort.field} onChange={(event) => updateSort({ ...sort, field: event.target.value as BookmarkSort['field'] })}><option value="manual">手动顺序</option><option value="title">标题</option><option value="domain">域名</option><option value="createdAt">创建时间</option><option value="updatedAt">更新时间</option><option value="visitedAt">最近访问</option><option value="health">链接状态</option><option value="confidence">AI 置信度</option></select></label><button type="button" aria-label={sort.direction === 'asc' ? '当前升序，切换为降序' : '当前降序，切换为升序'} onClick={() => updateSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}>{sort.direction === 'asc' ? <ArrowUp size={16}/> : <ArrowDown size={16}/>}</button></div><div className="bookmark-list-region">{loading ? <p className="empty-state">正在读取书签…</p> : bookmarks.length ? <BookmarkList bookmarks={bookmarks} onOpen={openBookmark} onContextMenu={showContext}/> : <p className="empty-state">此文件夹暂无书签</p>}</div></>}</main><aside className="manager-detail" aria-label="书签详情"><DetailPanel bookmark={detail} repository={repository} commands={commands} metadataRepository={metadataRepository}/></aside><ResponsiveDrawer open={drawer === 'folders'} label="文件夹" onClose={() => setDrawer(null)}>{folderTree}</ResponsiveDrawer><ResponsiveDrawer open={drawer === 'detail'} label="书签详情" onClose={() => setDrawer(null)}><DetailPanel bookmark={detail} repository={repository} commands={commands} metadataRepository={metadataRepository}/></ResponsiveDrawer>{moving ? <MoveBookmarkDialog bookmark={moving} folders={folders} onClose={() => setMoving(undefined)} onMove={(folderId) => void moveBookmark(moving.id, folderId)}/> : null}{context ? <div className="context-popover" style={{ left: context.x, top: context.y }} onClick={(event) => event.stopPropagation()}>{context.kind === 'bookmark' ? <BookmarkContextMenu onOpen={() => openBookmark(context.bookmark)} onMove={() => { setMoving(context.bookmark); setContext(undefined); }} onAnalyze={() => { onAnalyze?.(context.bookmark); setContext(undefined); }} onQueueReview={() => { onAnalyze?.(context.bookmark); setContext(undefined); }} onTag={() => { useManagerStore.setState({ detailBookmarkId: context.bookmark.id }); setContext(undefined); }} onExport={() => { exportBookmark(context.bookmark); setContext(undefined); }} onCopy={() => { if (context.bookmark.url) void navigator.clipboard.writeText(context.bookmark.url); setContext(undefined); }} onRecycle={() => { if (recycleBinId && globalThis.confirm?.(`将“${context.bookmark.title}”移到回收站？`)) void moveBookmark(context.bookmark.id, recycleBinId); }} recycleDisabledReason={recycleBinId ? undefined : '请先在设置中绑定回收站文件夹'}/> : <FolderContextMenu onCreate={() => void createChildFolder(context.folder)} onHealth={() => { onHealthScan?.(context.folder); setContext(undefined); }} healthDisabledReason={onHealthScan ? undefined : '健康检查服务将在增强功能启用后可用'}/>}</div> : null}</div>;
}

const healthOrder: Record<string, number> = { dead: 0, temporary: 1, restricted: 2, blocked: 3, unchecked: 4, healthy: 5 };
const confidenceOrder: Record<string, number> = { low: 0, unknown: 1, medium: 2, high: 3 };

function sortBookmarks(bookmarks: BookmarkNode[], sort: BookmarkSort, metadata: Map<string, BookmarkMetadata>, visits: Map<string, number>): BookmarkNode[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...bookmarks].sort((left, right) => {
    let comparison = 0;
    if (sort.field === 'manual') comparison = left.index - right.index;
    else if (sort.field === 'title') comparison = left.title.localeCompare(right.title, 'zh-CN');
    else if (sort.field === 'domain') comparison = domain(left.url).localeCompare(domain(right.url), 'zh-CN');
    else if (sort.field === 'createdAt') comparison = (left.dateAdded ?? 0) - (right.dateAdded ?? 0);
    else if (sort.field === 'updatedAt') comparison = (metadata.get(left.id)?.updatedAt ?? 0) - (metadata.get(right.id)?.updatedAt ?? 0);
    else if (sort.field === 'visitedAt') comparison = (visits.get(left.id) ?? 0) - (visits.get(right.id) ?? 0);
    else if (sort.field === 'health') comparison = (healthOrder[metadata.get(left.id)?.health ?? 'unchecked'] ?? 0) - (healthOrder[metadata.get(right.id)?.health ?? 'unchecked'] ?? 0);
    else if (sort.field === 'confidence') comparison = (confidenceOrder[metadata.get(left.id)?.confidence ?? 'unknown'] ?? 0) - (confidenceOrder[metadata.get(right.id)?.confidence ?? 'unknown'] ?? 0);
    return comparison === 0 ? left.index - right.index : comparison * direction;
  });
}

function domain(url?: string): string { try { return url ? new URL(url).hostname : ''; } catch { return ''; } }
