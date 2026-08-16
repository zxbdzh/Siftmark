import {
  ArrowDownAZ,
  CheckCircle2,
  ChevronRight,
  Folder,
  FolderInput,
  LoaderCircle,
  Pencil,
  Save,
  Search,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import { isBookmark, type BookmarkNode } from '../../src/bookmarks/types';
import { BrandMark } from '../../src/ui/components/BrandMark';

type BatchAction = 'sort' | 'rename' | 'classify' | 'health' | 'delete';
const CONTEXT_EXIT_MS = 120;

export default function App() {
  const repository = useMemo(
    () =>
      new ChromeBookmarkRepository(
        browser.bookmarks as unknown as ChromeBookmarkApi
      ),
    []
  );
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [selected, setSelected] = useState(new Set<string>());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<BatchAction>();
  const [status, setStatus] = useState('');
  const [context, setContext] = useState<{
    node: BookmarkNode;
    x: number;
    y: number;
  }>();
  const [contextClosing, setContextClosing] = useState(false);
  const contextCloseTimer = useRef<ReturnType<typeof globalThis.setTimeout>>();

  const refresh = useCallback(async () => {
    const next = await repository.getTree();
    setNodes(next);
    setExpanded((current) =>
      current.size
        ? current
        : new Set(
            next.filter((node) => node.parentId === '0').map((node) => node.id)
          )
    );
  }, [repository]);

  useEffect(() => {
    void refresh();
    let refreshTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const listener = () => {
      if (refreshTimer !== undefined) globalThis.clearTimeout(refreshTimer);
      refreshTimer = globalThis.setTimeout(() => void refresh(), 100);
    };
    browser.bookmarks.onCreated.addListener(listener);
    browser.bookmarks.onChanged.addListener(listener);
    browser.bookmarks.onMoved.addListener(listener);
    browser.bookmarks.onRemoved.addListener(listener);
    return () => {
      if (refreshTimer !== undefined) globalThis.clearTimeout(refreshTimer);
      browser.bookmarks.onCreated.removeListener(listener);
      browser.bookmarks.onChanged.removeListener(listener);
      browser.bookmarks.onMoved.removeListener(listener);
      browser.bookmarks.onRemoved.removeListener(listener);
    };
  }, [refresh]);

  const children = useMemo(() => {
    const map = new Map<string, BookmarkNode[]>();
    for (const node of nodes) {
      const rows = map.get(node.parentId) ?? [];
      rows.push(node);
      map.set(node.parentId, rows);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.index - b.index);
    return map;
  }, [nodes]);
  const visibleRoots = children.get('0') ?? [];
  const bookmarks = nodes.filter(isBookmark);
  const selectedBookmarks = bookmarks.filter((node) => selected.has(node.id));
  const selectedFolders = nodes.filter(
    (node) => !isBookmark(node) && selected.has(node.id)
  );

  const toggleFolder = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const descendants = (id: string): string[] =>
    (children.get(id) ?? []).flatMap((node) => [
      node.id,
      ...descendants(node.id)
    ]);
  const toggleSelection = (node: BookmarkNode) => {
    const ids = isBookmark(node)
      ? [node.id]
      : [node.id, ...descendants(node.id)];
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = ids.some((id) => !next.has(id));
      for (const id of ids) {
        if (shouldSelect) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const run = async (action: BatchAction) => {
    setBusy(action);
    setStatus('');
    try {
      if (action === 'sort') {
        const folders = selectedFolders.length ? selectedFolders : visibleRoots;
        for (const folder of folders) {
          const ordered = [...(children.get(folder.id) ?? [])].sort(
            (a, b) =>
              Number(isBookmark(a)) - Number(isBookmark(b)) ||
              a.title.localeCompare(b.title, 'zh-CN')
          );
          for (const [index, node] of ordered.entries())
            await repository.move(node.id, folder.id, index);
        }
        setStatus(`已整理 ${folders.length} 个文件夹的顺序`);
      } else if (action === 'delete') {
        if (
          !selected.size ||
          !globalThis.confirm(`确定删除已选择的 ${selected.size} 项？`)
        )
          return;
        const topLevel = [...selected].filter(
          (id) =>
            !selected.has(nodes.find((node) => node.id === id)?.parentId ?? '')
        );
        for (const id of topLevel) {
          const node = nodes.find((item) => item.id === id);
          if (!node) continue;
          if (isBookmark(node)) await repository.remove(id);
          else await browser.bookmarks.removeTree(id);
        }
        setSelected(new Set());
        setStatus(`已删除 ${topLevel.length} 项`);
      } else {
        if (!selectedBookmarks.length) throw new Error('请先选择书签');
        const type =
          action === 'rename'
            ? 'bulk-rename'
            : action === 'classify'
              ? 'bulk-classify'
              : 'bulk-health';
        const results = (await browser.runtime.sendMessage({
          type,
          input: { bookmarkIds: selectedBookmarks.map((node) => node.id) }
        })) as Array<{ success?: boolean }>;
        const failed = Array.isArray(results)
          ? results.filter((result) => result?.success === false).length
          : 0;
        setStatus(
          `${actionLabel(action)}完成：${selectedBookmarks.length - failed} 成功${failed ? `，${failed} 失败` : ''}`
        );
      }
      await refresh();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : `${actionLabel(action)}失败`
      );
    } finally {
      setBusy(undefined);
    }
  };

  const closeContext = useCallback(() => {
    if (!context || contextClosing) return;
    setContextClosing(true);
    contextCloseTimer.current = globalThis.setTimeout(() => {
      setContext(undefined);
      setContextClosing(false);
    }, CONTEXT_EXIT_MS);
  }, [context, contextClosing]);

  const openContext = useCallback(
    (next: { node: BookmarkNode; x: number; y: number }) => {
      if (contextCloseTimer.current !== undefined)
        globalThis.clearTimeout(contextCloseTimer.current);
      setContextClosing(false);
      setContext(next);
    },
    []
  );

  useEffect(
    () => () => {
      if (contextCloseTimer.current !== undefined)
        globalThis.clearTimeout(contextCloseTimer.current);
    },
    []
  );

  const editNode = async (node: BookmarkNode) => {
    const title = globalThis.prompt('修改名称', node.title)?.trim();
    if (title && title !== node.title)
      await repository.update(node.id, { title });
    closeContext();
    await refresh();
  };
  const createFolder = async (node: BookmarkNode) => {
    const parentId = isBookmark(node) ? node.parentId : node.id;
    const title = globalThis.prompt('新文件夹名称')?.trim();
    if (title) await repository.create({ parentId, index: 0, title });
    closeContext();
    await refresh();
  };

  const renderNode = (node: BookmarkNode, depth: number): React.ReactNode => {
    const folder = !isBookmark(node);
    const childRows = children.get(node.id) ?? [];
    const matches =
      !query ||
      `${node.title} ${node.url ?? ''}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase());
    const descendantMatches =
      folder && childRows.some((child) => nodeMatches(child, query, children));
    if (!matches && !descendantMatches) return null;
    const open = expanded.has(node.id) || Boolean(query);
    return (
      <div key={node.id}>
        <div
          className="bookmark-tree-row"
          data-folder={folder}
          data-selected={selected.has(node.id)}
          style={{ '--tree-depth': depth } as React.CSSProperties}
          draggable
          onDragStart={(event) =>
            event.dataTransfer.setData('text/bookmark-id', node.id)
          }
          onDragOver={(event) => {
            if (folder) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!folder) return;
            event.preventDefault();
            const sourceId = event.dataTransfer.getData('text/bookmark-id');
            if (sourceId && sourceId !== node.id)
              void repository.move(sourceId, node.id).then(refresh);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openContext({ node, x: event.clientX, y: event.clientY });
          }}
        >
          <button
            type="button"
            className="tree-disclosure"
            aria-label={folder ? (open ? '折叠文件夹' : '展开文件夹') : '书签'}
            aria-expanded={folder ? open : undefined}
            disabled={!folder}
            onClick={() => folder && toggleFolder(node.id)}
          >
            {folder ? <ChevronRight data-open={open || undefined} /> : <span />}
          </button>
          <label>
            <input
              type="checkbox"
              aria-label={`${folder ? '选择文件夹' : '选择书签'} ${node.title}`}
              checked={selected.has(node.id)}
              onChange={() => toggleSelection(node)}
            />
          </label>
          {folder ? (
            <Folder size={17} />
          ) : (
            <span className="bookmark-favicon">{domainInitial(node.url)}</span>
          )}
          <button
            type="button"
            className="tree-title"
            onDoubleClick={() => void editNode(node)}
            onClick={() => {
              if (isBookmark(node)) void browser.tabs.create({ url: node.url });
              else toggleFolder(node.id);
            }}
          >
            <span>{node.title || (folder ? '未命名文件夹' : node.url)}</span>
            {node.url ? (
              <small>{safeDomain(node.url)}</small>
            ) : (
              <small>{childRows.length} 项</small>
            )}
          </button>
        </div>
        {folder && open
          ? childRows.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  return (
    <main className="manager-page" onClick={closeContext}>
      <header className="manager-topbar">
        <strong className="brand-type">
          <BrandMark className="manager-brand-mark" />
          Siftmark <span>· 书签树</span>
        </strong>
        <button
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <Settings size={17} />
          设置
        </button>
      </header>
      <div className="manager-workspace">
        <section className="tree-panel">
          <div className="tree-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索书签…"
            />
            {query ? (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => setQuery('')}
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
          <div className="tree-scroll">
            {visibleRoots.map((node) => renderNode(node, 0))}
          </div>
        </section>
        <aside className="bulk-toolbar">
          <div className="selection-count">
            已选 <strong>{selectedBookmarks.length}</strong> 个书签
          </div>
          <button
            type="button"
            onClick={() =>
              setSelected(new Set(bookmarks.map((node) => node.id)))
            }
          >
            全选书签
          </button>
          <button type="button" onClick={() => setSelected(new Set())}>
            清空选择
          </button>
          <hr />
          <button
            type="button"
            onClick={() =>
              void browser.tabs.create({
                url: `${browser.runtime.getURL('/options.html')}#backup`
              })
            }
          >
            <Save />
            备份当前书签
          </button>
          <button
            type="button"
            aria-busy={busy === 'sort'}
            disabled={Boolean(busy)}
            onClick={() => void run('sort')}
          >
            {busy === 'sort' ? (
              <LoaderCircle className="manager-spinner" />
            ) : (
              <ArrowDownAZ />
            )}
            批量排序
          </button>
          <button
            type="button"
            aria-busy={busy === 'rename'}
            disabled={Boolean(busy) || !selectedBookmarks.length}
            onClick={() => void run('rename')}
          >
            {busy === 'rename' ? (
              <LoaderCircle className="manager-spinner" />
            ) : (
              <Pencil />
            )}
            批量改名
          </button>
          <button
            type="button"
            aria-busy={busy === 'classify'}
            disabled={Boolean(busy) || !selectedBookmarks.length}
            onClick={() => void run('classify')}
          >
            {busy === 'classify' ? (
              <LoaderCircle className="manager-spinner" />
            ) : (
              <FolderInput />
            )}
            批量归类
          </button>
          <button
            type="button"
            aria-busy={busy === 'health'}
            disabled={Boolean(busy) || !selectedBookmarks.length}
            onClick={() => void run('health')}
          >
            {busy === 'health' ? (
              <LoaderCircle className="manager-spinner" />
            ) : (
              <CheckCircle2 />
            )}
            检测失效
          </button>
          <button
            type="button"
            className="danger"
            aria-busy={busy === 'delete'}
            disabled={Boolean(busy) || !selected.size}
            onClick={() => void run('delete')}
          >
            {busy === 'delete' ? (
              <LoaderCircle className="manager-spinner" />
            ) : (
              <Trash2 />
            )}
            批量删除
          </button>
          <output key={busy ? `busy:${busy}` : `status:${status}`}>
            {busy ? `${actionLabel(busy)}处理中…` : status}
          </output>
        </aside>
      </div>
      {context ? (
        <menu
          className="tree-context-menu"
          data-closing={contextClosing || undefined}
          style={{ left: context.x, top: context.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void editNode(context.node)}>
            <Pencil />
            重命名
          </button>
          <button type="button" onClick={() => void createFolder(context.node)}>
            <Folder />
            新建文件夹
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setSelected(new Set([context.node.id]));
              closeContext();
            }}
          >
            <Trash2 />
            选择后删除
          </button>
        </menu>
      ) : null}
    </main>
  );
}

function actionLabel(action: BatchAction): string {
  return {
    sort: '排序',
    rename: 'AI 改名',
    classify: 'AI 归类',
    health: '失效检测',
    delete: '删除'
  }[action];
}
function safeDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
function domainInitial(url?: string): string {
  return url ? (safeDomain(url)[0] ?? '•').toUpperCase() : '•';
}
function nodeMatches(
  node: BookmarkNode,
  query: string,
  children: Map<string, BookmarkNode[]>
): boolean {
  if (!query) return true;
  if (
    `${node.title} ${node.url ?? ''}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  )
    return true;
  return (children.get(node.id) ?? []).some((child) =>
    nodeMatches(child, query, children)
  );
}
