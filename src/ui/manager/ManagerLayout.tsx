import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Menu,
  PanelRight,
  Settings2
} from 'lucide-react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkNode } from '../../bookmarks/types';
import { isBookmark } from '../../bookmarks/types';
import { BookmarkList } from './BookmarkList';
import { DetailPanel, type DetailLifecycleAction } from './DetailPanel';
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
import type { ThumbnailRepository } from '../../storage/thumbnail-repository';
import type { SearchService } from '../../search/search-service';
import type { SearchResult } from '../../search/types';
import { SearchBar } from '../search/SearchBar';
import type { ArchiveService } from '../../bookmarks/archive-service';
import type {
  RecycleService,
  SpecialFolderPlacement
} from '../../bookmarks/recycle-service';

interface ManagerLayoutProps {
  nodes: BookmarkNode[];
  loading: boolean;
  repository: BookmarkRepository;
  commands?: BookmarkCommandService;
  archiveService?: ArchiveService;
  recycleService?: RecycleService;
  archiveDestination?: BookmarkNode;
  recycleDestination?: BookmarkNode;
  specialFolderPlacements?: Map<string, SpecialFolderPlacement>;
  onRefresh?(): Promise<void> | void;
  onAnalyze?(bookmark: BookmarkNode): void;
  onHealthScan?(folder: BookmarkNode): void;
  reviewWorkspace?: ReactNode;
  notificationCenter?: ReactNode;
  usageInsights?: ReactNode;
  metadataRepository?: MetadataRepository;
  metadataById?: Map<string, BookmarkMetadata>;
  visitsById?: Map<string, number>;
  sortRepository?: {
    getFolderSort(folderId: string): Promise<BookmarkSort>;
    setFolderSort(folderId: string, sort: BookmarkSort): Promise<void>;
  };
  draftWorkspace?: ReactNode;
  thumbnailRepository?: ThumbnailRepository;
  searchService?: SearchService;
  onRefreshThumbnail?(bookmark: BookmarkNode): void;
  aiStatus?: ManagerAiStatus;
  onOpenAiSettings?(): void;
}

export interface ManagerAiStatus {
  state: 'unconfigured' | 'draft' | 'verified' | 'ready';
  label: string;
  detail: string;
}

export function ManagerLayout({
  nodes,
  loading,
  repository,
  commands,
  archiveService,
  recycleService,
  archiveDestination,
  recycleDestination,
  specialFolderPlacements = new Map(),
  onRefresh,
  onAnalyze,
  onHealthScan,
  reviewWorkspace,
  notificationCenter,
  usageInsights,
  metadataRepository,
  metadataById = new Map(),
  visitsById = new Map(),
  sortRepository,
  draftWorkspace,
  thumbnailRepository,
  searchService,
  onRefreshThumbnail,
  aiStatus = {
    state: 'unconfigured',
    label: '未配置',
    detail: '尚未配置 AI 模型'
  },
  onOpenAiSettings
}: ManagerLayoutProps) {
  const [drawer, setDrawer] = useState<'folders' | 'detail' | null>(null);
  const [view, setView] = useState<
    'bookmarks' | 'review' | 'drafts' | 'notifications' | 'insights'
  >('bookmarks');
  const [moving, setMoving] = useState<BookmarkNode>();
  const [restoring, setRestoring] = useState<BookmarkNode>();
  const [context, setContext] = useState<
    (
      | { kind: 'bookmark'; bookmark: BookmarkNode }
      | { kind: 'folder'; folder: BookmarkNode }
    ) & { x: number; y: number }
  >();
  const [searchResults, setSearchResults] = useState<SearchResult[]>();
  const folderId = useManagerStore((state) => state.selectedFolderId);
  const detailId = useManagerStore((state) => state.detailBookmarkId);
  const sort = useManagerStore((state) => state.sort);
  const setSort = useManagerStore((state) => state.setSort);
  const folders = nodes.filter((node) => !isBookmark(node));
  const hiddenSpecialNodeIds = useMemo(() => {
    const hidden = new Set(specialFolderPlacements.keys());
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (hidden.has(node.parentId) && !hidden.has(node.id)) {
          hidden.add(node.id);
          changed = true;
        }
      }
    }
    return hidden;
  }, [nodes, specialFolderPlacements]);
  const searchRank = useMemo(
    () =>
      searchResults
        ? new Map(
            searchResults.map((result, index) => [result.bookmarkId, index])
          )
        : undefined,
    [searchResults]
  );
  const bookmarks = useMemo(() => {
    const matches = nodes.filter(
      (node) =>
        isBookmark(node) &&
        (searchRank
          ? searchRank.has(node.id)
          : !folderId
            ? !hiddenSpecialNodeIds.has(node.id)
            : node.parentId === folderId)
    );
    if (searchRank)
      return matches.sort(
        (left, right) =>
          (searchRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (searchRank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
    return sortBookmarks(matches, sort, metadataById, visitsById);
  }, [
    folderId,
    hiddenSpecialNodeIds,
    metadataById,
    nodes,
    searchRank,
    sort,
    visitsById
  ]);
  const detail = nodes.find((node) => node.id === detailId);
  const sortFolderId = folderId ?? '__all__';
  const handleSearchResults = useCallback(
    (results?: SearchResult[]) => setSearchResults(results),
    []
  );
  const handleSelectSearchResult = useCallback(
    (bookmarkId: string) =>
      useManagerStore.getState().selectBookmark(bookmarkId),
    []
  );
  useEffect(() => {
    let active = true;
    if (sortRepository)
      void sortRepository.getFolderSort(sortFolderId).then((value) => {
        if (active) setSort(value);
      });
    return () => {
      active = false;
    };
  }, [setSort, sortFolderId, sortRepository]);
  const updateSort = (next: BookmarkSort) => {
    setSort(next);
    void sortRepository?.setFolderSort(sortFolderId, next);
  };
  const moveBookmark = async (bookmarkId: string, destinationId: string) => {
    const bookmark = nodes.find((node) => node.id === bookmarkId);
    if (!bookmark || !commands || bookmark.parentId === destinationId) return;
    const result = await commands.move({
      bookmarkId,
      parentId: destinationId,
      expected: { parentId: bookmark.parentId, index: bookmark.index }
    });
    if (!result.ok)
      globalThis.alert?.('书签已在其他位置发生变化，请刷新后重试。');
    setMoving(undefined);
    setContext(undefined);
    await onRefresh?.();
  };
  const openBookmark = (bookmark: BookmarkNode) => {
    if (bookmark.url) void browser.tabs.create({ url: bookmark.url });
  };
  const exportBookmark = (bookmark: BookmarkNode) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, bookmark }, null, 2)], {
        type: 'application/json'
      })
    );
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
  const runSpecialMove = async (
    kind: 'archive' | 'recycle',
    node: BookmarkNode
  ) => {
    const destination =
      kind === 'archive' ? archiveDestination : recycleDestination;
    const service = kind === 'archive' ? archiveService : recycleService;
    if (!destination || !service) return;
    const verb = kind === 'archive' ? '归档' : '移到回收站';
    if (
      !globalThis.confirm?.(
        `${verb}“${node.title}”到“${destination.title || '书签'}”？`
      )
    )
      return;
    setContext(undefined);
    const result =
      kind === 'archive'
        ? await archiveService!.archive(node.id)
        : await recycleService!.recycle(node.id);
    if (!result.ok)
      globalThis.alert?.(specialFolderErrorMessage(result.error.code));
    await onRefresh?.();
  };
  const runRestore = async (
    node: BookmarkNode,
    selectedDestinationId?: string
  ) => {
    const placement = specialFolderPlacements.get(node.id);
    if (!placement) return;
    const service =
      placement.state === 'archived' ? archiveService : recycleService;
    if (!service) return;
    const result = await service.restore(node.id, selectedDestinationId);
    if (!result.ok) {
      if (result.error.code === 'destination-required') {
        setRestoring(node);
        return;
      }
      globalThis.alert?.(specialFolderErrorMessage(result.error.code));
      return;
    }
    setRestoring(undefined);
    setContext(undefined);
    await onRefresh?.();
  };
  const lifecycleActions = (
    node?: BookmarkNode
  ): {
    archiveAction?: DetailLifecycleAction;
    recycleAction?: DetailLifecycleAction;
    restoreAction?: DetailLifecycleAction;
  } => {
    if (!node) return {};
    const placement = specialFolderPlacements.get(node.id);
    if (placement) {
      const originalParent = folders.find(
        (folder) => folder.id === placement.originalParentId
      );
      const label = originalParent
        ? `恢复到「${originalParent.title || '书签'}」`
        : '选择恢复位置…';
      return {
        restoreAction: {
          label,
          onAction: () => {
            if (!originalParent) {
              setRestoring(node);
              setContext(undefined);
              return;
            }
            if (
              globalThis.confirm?.(
                `将“${node.title}”恢复到“${originalParent.title || '书签'}”？`
              )
            )
              void runRestore(node);
          }
        }
      };
    }
    const archiveUnavailable =
      !archiveService || !archiveDestination
        ? '请先在设置中绑定有效的归档文件夹'
        : archiveDestination.id === node.id
          ? '不能归档特殊文件夹本身'
          : undefined;
    const recycleUnavailable =
      !recycleService || !recycleDestination
        ? '请先在设置中绑定有效的回收站文件夹'
        : recycleDestination.id === node.id
          ? '不能移动回收站本身'
          : undefined;
    return {
      archiveAction: {
        label: archiveDestination
          ? `归档到「${archiveDestination.title || '书签'}」`
          : '归档',
        disabledReason: archiveUnavailable,
        onAction: () => void runSpecialMove('archive', node)
      },
      recycleAction: {
        label: recycleDestination
          ? `移到「${recycleDestination.title || '书签'}」`
          : '移到回收站',
        disabledReason: recycleUnavailable,
        onAction: () => void runSpecialMove('recycle', node)
      }
    };
  };
  const showContext = (
    bookmark: BookmarkNode,
    position: { x: number; y: number }
  ) => setContext({ kind: 'bookmark', bookmark, ...position });
  const showFolderContext = (
    folder: BookmarkNode,
    position: { x: number; y: number }
  ) => setContext({ kind: 'folder', folder, ...position });
  const folderTree = (
    <FolderTree
      folders={folders}
      onDropBookmark={(bookmarkId, folderId) =>
        void moveBookmark(bookmarkId, folderId)
      }
      onContextMenu={showFolderContext}
    />
  );
  const mainLabel =
    view === 'review'
      ? '审核工作区'
      : view === 'drafts'
        ? '笔记草稿'
        : view === 'notifications'
          ? '通知中心'
          : view === 'insights'
            ? '访问统计'
            : '书签列表';
  const detailActions = lifecycleActions(detail);
  const contextNode = context
    ? context.kind === 'bookmark'
      ? context.bookmark
      : context.folder
    : undefined;
  const contextActions = lifecycleActions(contextNode);
  return (
    <div className="manager-shell" onClick={() => setContext(undefined)}>
      <header className="manager-header">
        <strong className="brand-type">Siftmark</strong>
        <div
          className="manager-view-switch"
          role="tablist"
          aria-label="管理器工作区"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === 'bookmarks'}
            onClick={() => setView('bookmarks')}
          >
            书签
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'review'}
            onClick={() => setView('review')}
          >
            审核
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'drafts'}
            onClick={() => setView('drafts')}
          >
            草稿
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'notifications'}
            onClick={() => setView('notifications')}
          >
            通知
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'insights'}
            onClick={() => setView('insights')}
          >
            统计
          </button>
        </div>
        <div className="manager-header-actions">
          <button
            type="button"
            className="ai-settings-button"
            data-state={aiStatus.state}
            title={aiStatus.detail}
            aria-label={`AI 设置：${aiStatus.label}。${aiStatus.detail}`}
            onClick={onOpenAiSettings}
          >
            <Bot size={17} />
            <span>AI {aiStatus.label}</span>
            <Settings2 size={15} />
          </button>
          <nav aria-label="管理器视图">
            <button
              type="button"
              onClick={() => setDrawer('folders')}
              aria-label="打开文件夹"
            >
              <Menu size={18} />
            </button>
            <button
              type="button"
              onClick={() => setDrawer('detail')}
              aria-label="打开详情"
            >
              <PanelRight size={18} />
            </button>
          </nav>
        </div>
      </header>
      <aside className="manager-folders" aria-label="文件夹">
        {folderTree}
      </aside>
      <main className="manager-list" aria-label={mainLabel}>
        {view === 'review' ? (
          (reviewWorkspace ?? <p className="empty-state">暂无审核项目</p>)
        ) : view === 'drafts' ? (
          (draftWorkspace ?? <p className="empty-state">暂无笔记草稿</p>)
        ) : view === 'notifications' ? (
          (notificationCenter ?? <p className="empty-state">暂无通知</p>)
        ) : view === 'insights' ? (
          (usageInsights ?? <p className="empty-state">暂无访问统计</p>)
        ) : (
          <>
            <div className="bookmark-toolbar">
              {searchService ? (
                <SearchBar
                  service={searchService}
                  folders={folders}
                  onResults={handleSearchResults}
                  onSelectResult={handleSelectSearchResult}
                />
              ) : null}
              <div className="bookmark-sort-control">
                <label>
                  排序
                  <select
                    aria-label="排序字段"
                    value={sort.field}
                    onChange={(event) =>
                      updateSort({
                        ...sort,
                        field: event.target.value as BookmarkSort['field']
                      })
                    }
                  >
                    <option value="manual">手动顺序</option>
                    <option value="title">标题</option>
                    <option value="domain">域名</option>
                    <option value="createdAt">创建时间</option>
                    <option value="updatedAt">更新时间</option>
                    <option value="visitedAt">最近访问</option>
                    <option value="health">链接状态</option>
                    <option value="confidence">AI 置信度</option>
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={
                    sort.direction === 'asc'
                      ? '当前升序，切换为降序'
                      : '当前降序，切换为升序'
                  }
                  onClick={() =>
                    updateSort({
                      ...sort,
                      direction: sort.direction === 'asc' ? 'desc' : 'asc'
                    })
                  }
                >
                  {sort.direction === 'asc' ? (
                    <ArrowUp size={16} />
                  ) : (
                    <ArrowDown size={16} />
                  )}
                </button>
              </div>
            </div>
            <div className="bookmark-list-region">
              {loading ? (
                <p className="empty-state">正在读取书签…</p>
              ) : bookmarks.length ? (
                <BookmarkList
                  bookmarks={bookmarks}
                  onOpen={openBookmark}
                  onContextMenu={showContext}
                />
              ) : (
                <p className="empty-state">
                  {searchResults ? '未找到匹配的书签' : '此文件夹暂无书签'}
                </p>
              )}
            </div>
          </>
        )}
      </main>
      <aside className="manager-detail" aria-label="书签详情">
        <DetailPanel
          bookmark={detail}
          repository={repository}
          commands={commands}
          metadataRepository={metadataRepository}
          thumbnailRepository={thumbnailRepository}
          onRefreshThumbnail={onRefreshThumbnail}
          {...detailActions}
        />
      </aside>
      <ResponsiveDrawer
        open={drawer === 'folders'}
        label="文件夹"
        onClose={() => setDrawer(null)}
      >
        {folderTree}
      </ResponsiveDrawer>
      <ResponsiveDrawer
        open={drawer === 'detail'}
        label="书签详情"
        onClose={() => setDrawer(null)}
      >
        <DetailPanel
          bookmark={detail}
          repository={repository}
          commands={commands}
          metadataRepository={metadataRepository}
          thumbnailRepository={thumbnailRepository}
          onRefreshThumbnail={onRefreshThumbnail}
          {...detailActions}
        />
      </ResponsiveDrawer>
      {moving ? (
        <MoveBookmarkDialog
          bookmark={moving}
          folders={folders}
          onClose={() => setMoving(undefined)}
          onMove={(folderId) => void moveBookmark(moving.id, folderId)}
        />
      ) : null}
      {restoring ? (
        <MoveBookmarkDialog
          bookmark={restoring}
          folders={folders}
          onClose={() => setRestoring(undefined)}
          onMove={(folderId) => void runRestore(restoring, folderId)}
        />
      ) : null}
      {context ? (
        <div
          className="context-popover"
          style={{ left: context.x, top: context.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {context.kind === 'bookmark' ? (
            <BookmarkContextMenu
              onOpen={() => openBookmark(context.bookmark)}
              onMove={() => {
                setMoving(context.bookmark);
                setContext(undefined);
              }}
              onAnalyze={() => {
                onAnalyze?.(context.bookmark);
                setContext(undefined);
              }}
              onQueueReview={() => {
                onAnalyze?.(context.bookmark);
                setContext(undefined);
              }}
              onTag={() => {
                useManagerStore.setState({
                  detailBookmarkId: context.bookmark.id
                });
                setContext(undefined);
              }}
              onExport={() => {
                exportBookmark(context.bookmark);
                setContext(undefined);
              }}
              onCopy={() => {
                if (context.bookmark.url)
                  void navigator.clipboard.writeText(context.bookmark.url);
                setContext(undefined);
              }}
              onArchive={contextActions.archiveAction?.onAction}
              archiveLabel={contextActions.archiveAction?.label}
              archiveDisabledReason={
                contextActions.archiveAction?.disabledReason
              }
              onRecycle={contextActions.recycleAction?.onAction}
              recycleLabel={contextActions.recycleAction?.label}
              recycleDisabledReason={
                contextActions.recycleAction?.disabledReason
              }
              onRestore={contextActions.restoreAction?.onAction}
              restoreLabel={contextActions.restoreAction?.label}
            />
          ) : (
            <FolderContextMenu
              onCreate={() => void createChildFolder(context.folder)}
              onHealth={() => {
                onHealthScan?.(context.folder);
                setContext(undefined);
              }}
              healthDisabledReason={
                onHealthScan ? undefined : '健康检查服务将在增强功能启用后可用'
              }
              onArchive={contextActions.archiveAction?.onAction}
              archiveLabel={contextActions.archiveAction?.label}
              archiveDisabledReason={
                contextActions.archiveAction?.disabledReason
              }
              onRecycle={contextActions.recycleAction?.onAction}
              recycleLabel={contextActions.recycleAction?.label}
              recycleDisabledReason={
                contextActions.recycleAction?.disabledReason
              }
              onRestore={contextActions.restoreAction?.onAction}
              restoreLabel={contextActions.restoreAction?.label}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

const healthOrder: Record<string, number> = {
  dead: 0,
  temporary: 1,
  restricted: 2,
  blocked: 3,
  unchecked: 4,
  healthy: 5
};
const confidenceOrder: Record<string, number> = {
  low: 0,
  unknown: 1,
  medium: 2,
  high: 3
};

function sortBookmarks(
  bookmarks: BookmarkNode[],
  sort: BookmarkSort,
  metadata: Map<string, BookmarkMetadata>,
  visits: Map<string, number>
): BookmarkNode[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...bookmarks].sort((left, right) => {
    let comparison = 0;
    if (sort.field === 'manual') comparison = left.index - right.index;
    else if (sort.field === 'title')
      comparison = left.title.localeCompare(right.title, 'zh-CN');
    else if (sort.field === 'domain')
      comparison = domain(left.url).localeCompare(domain(right.url), 'zh-CN');
    else if (sort.field === 'createdAt')
      comparison = (left.dateAdded ?? 0) - (right.dateAdded ?? 0);
    else if (sort.field === 'updatedAt')
      comparison =
        (metadata.get(left.id)?.updatedAt ?? 0) -
        (metadata.get(right.id)?.updatedAt ?? 0);
    else if (sort.field === 'visitedAt')
      comparison = (visits.get(left.id) ?? 0) - (visits.get(right.id) ?? 0);
    else if (sort.field === 'health')
      comparison =
        (healthOrder[metadata.get(left.id)?.health ?? 'unchecked'] ?? 0) -
        (healthOrder[metadata.get(right.id)?.health ?? 'unchecked'] ?? 0);
    else if (sort.field === 'confidence')
      comparison =
        (confidenceOrder[metadata.get(left.id)?.confidence ?? 'unknown'] ?? 0) -
        (confidenceOrder[metadata.get(right.id)?.confidence ?? 'unknown'] ?? 0);
    return comparison === 0 ? left.index - right.index : comparison * direction;
  });
}

function domain(url?: string): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

function specialFolderErrorMessage(code: string): string {
  if (code === 'missing-special-folder')
    return '特殊文件夹已被删除，相关功能已暂停。请先在设置中重新绑定。';
  if (code === 'unbound-special-folder') return '请先在设置中绑定特殊文件夹。';
  if (code === 'destination-required') return '请选择一个恢复目的地。';
  if (code === 'conflict') return '书签位置已发生变化，请刷新后重试。';
  if (code === 'not_found') return '未找到该书签，列表即将刷新。';
  return '操作未完成，请刷新后重试。';
}
