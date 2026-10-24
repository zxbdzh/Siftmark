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
import { beginBookmarkActivity } from '../../src/operations/bookmark-activity';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import { isBookmark, type BookmarkNode } from '../../src/bookmarks/types';
import { BrandMark } from '../../src/ui/components/BrandMark';
import { createDefaultAiAdapterRegistry } from '../../src/ai/create-adapter-registry';
import { ChromeProfileRepository } from '../../src/ai/profiles/profile-repository';
import { selectProfileForCapability } from '../../src/ai/profiles/profile-selector';
import { modelProfileKey } from '../../src/ai/profiles/profile-key';
import type { ModelProfile } from '../../src/ai/types';
import { UsageRepository } from '../../src/ai/network/usage-repository';
import { BookmarkOrganizationPlanner } from '../../src/bookmarks/organization-planner';
import {
  organizeBookmarks,
  organizationScope,
  type OrganizeProgress
} from '../../src/bookmarks/organize-bookmarks';
import {
  clearOrganizationCheckpoint,
  loadOrganizationCheckpoint,
  saveOrganizationCheckpoint,
  type OrganizationCheckpoint
} from '../../src/bookmarks/organization-checkpoint';
import {
  OrganizationProcessDialog,
  organizeProgressText
} from '../../src/ui/manager/OrganizationProcessDialog';
import { downloadBookmarkHtml } from '../../src/backup/download-bookmark-html';
import { ChromeSettingsRepository } from '../../src/settings/settings-repository';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { RecycleService } from '../../src/bookmarks/recycle-service';
import { SpecialFolderService } from '../../src/bookmarks/special-folders';
import { DexieSpecialFolderPlacementRepository } from '../../src/bookmarks/placement-repository';
import { BookmarkCommandService } from '../../src/operations/bookmark-command-service';
import { DexieOperationRepository } from '../../src/operations/operation-repository';
import type { OrganizationApproval } from '../../src/bookmarks/organize-bookmarks';
import { groupOrganizationDuplicates } from '../../src/bookmarks/organization-duplicates';
import {
  OrganizationReviewRepository,
  resolveOrganizationReview,
  type OrganizationReviewRecord
} from '../../src/bookmarks/organization-review';
import { OrganizationReviewDialog } from '../../src/ui/manager/OrganizationReviewDialog';
import { AgentExperienceService, experienceScore, type CaptureLearningMemory } from '../../src/capture-agent';
import { applyOrganizationExperience } from '../../src/capture-agent/organization-experience';
import { UndoService } from '../../src/operations/undo-service';

type BatchAction =
  'organize' | 'sort' | 'rename' | 'classify' | 'health' | 'delete';
const CONTEXT_EXIT_MS = 120;
const ORGANIZATION_UNDO_KEY = 'siftmark.organization.last-undo.v1';

export default function App() {
  const repository = useMemo(
    () =>
      new ChromeBookmarkRepository(
        browser.bookmarks as unknown as ChromeBookmarkApi
      ),
    []
  );
  const learningDatabase = useMemo(() => openSiftmarkDatabase(), []);
  const experiences = useMemo(() => new AgentExperienceService(learningDatabase, new ChromeSettingsRepository(browser.storage.local), repository), [learningDatabase, repository]);
  const [learningMemories, setLearningMemories] = useState<CaptureLearningMemory[]>([]);
  const [manualMove, setManualMove] = useState<{ batchId: string; bookmarkId: string; folderId: string }>();
  const [organizationUndoBatchId, setOrganizationUndoBatchId] = useState<string>();
  useEffect(() => {
    void browser.storage.local.get(ORGANIZATION_UNDO_KEY).then((stored) => {
      if (typeof stored[ORGANIZATION_UNDO_KEY] === 'string') setOrganizationUndoBatchId(stored[ORGANIZATION_UNDO_KEY] as string);
    });
  }, []);
  useEffect(() => () => learningDatabase.close(), [learningDatabase]);
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [selected, setSelected] = useState(new Set<string>());
  const [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void experiences.memories(query).then((memories) => { if (active) setLearningMemories(memories); }).catch(() => { if (active) setLearningMemories([]); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [experiences, query, nodes]);
  const searchScores = useMemo(() => {
    const scores = new Map<string, number>();
    if (!query.trim() || !learningMemories.length) return scores;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes.filter(isBookmark)) {
      const score = experienceScore(node, learningMemories, query);
      scores.set(node.id, score);
      let parent = byId.get(node.parentId);
      while (parent) { scores.set(parent.id, Math.max(scores.get(parent.id) ?? 0, score)); parent = byId.get(parent.parentId); }
    }
    return scores;
  }, [nodes, query, learningMemories]);
  const [busy, setBusy] = useState<BatchAction>();
  const [status, setStatus] = useState('');
  const [organizeProgress, setOrganizeProgress] = useState<OrganizeProgress>();
  const [organizeProfiles, setOrganizeProfiles] = useState<ModelProfile[]>([]);
  const [organizeProfileKey, setOrganizeProfileKey] = useState('');
  const [organizeCheckpoint, setOrganizeCheckpoint] =
    useState<OrganizationCheckpoint>();
  const [organizeConcurrency, setOrganizeConcurrency] = useState(2);
  const [organizePickerOpen, setOrganizePickerOpen] = useState(false);
  const [organizeModel, setOrganizeModel] = useState<ModelProfile>();
  const [organizeProcessOpen, setOrganizeProcessOpen] = useState(false);
  const [similarityRecords, setSimilarityRecords] = useState<
    OrganizationReviewRecord[]
  >([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [organizeScope, setOrganizeScope] = useState({
    total: 0,
    skipped: 0,
    duplicates: 0
  });
  const confirmPlan =
    useRef<(approved: boolean | OrganizationApproval) => void>();
  const pickerRef = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const [context, setContext] = useState<{
    node: BookmarkNode;
    x: number;
    y: number;
  }>();
  const [contextClosing, setContextClosing] = useState(false);
  const contextCloseTimer = useRef<ReturnType<typeof globalThis.setTimeout>>();

  useEffect(() => {
    const dialog = pickerRef.current;
    if (!dialog) return;
    if (organizePickerOpen && !dialog.open) dialog.showModal();
    else if (!organizePickerOpen && dialog.open) dialog.close();
  }, [organizePickerOpen]);
  useEffect(() => () => confirmPlan.current?.(false), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (running.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const loadReviews = useCallback(async () => {
    const database = openSiftmarkDatabase();
    try {
      setSimilarityRecords(
        await new OrganizationReviewRepository(database).list()
      );
    } finally {
      database.close();
    }
  }, []);
  useEffect(() => {
    void loadReviews().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : '相似记录读取失败')
    );
  }, [loadReviews]);

  const resolveReview = async (id: string, keepBookmarkId?: string) => {
    if (reviewBusy || running.current) return;
    setReviewBusy(true);
    setReviewError('');
    try {
      await navigator.locks.request(
        'siftmark-similarity-review',
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error('另一个管理器正在处理相似项，请稍后重试');
          const database = openSiftmarkDatabase();
          try {
            const settings = new ChromeSettingsRepository(
              browser.storage.local
            );
            const special = await settings.getSpecialFolders();
            const specialFolders = new SpecialFolderService(
              repository,
              settings
            );
            if (
              keepBookmarkId &&
              !(await specialFolders.check('recycleBin')).ok
            )
              throw new Error('请先在设置绑定有效回收站');
            const recycle = new RecycleService(
              repository,
              new BookmarkCommandService(
                repository,
                new DexieOperationRepository(database)
              ),
              specialFolders,
              new DexieSpecialFolderPlacementRepository(database)
            );
            await resolveOrganizationReview({
              db: database,
              recordId: id,
              keepBookmarkId,
              bookmarks: repository,
              excludedFolderIds: [
                special.archiveId,
                special.recycleBinId
              ].filter((value): value is string => Boolean(value)),
              backup: downloadBookmarkHtml,
              recycle: async (bookmark) => {
                const result = await recycle.recycle(bookmark.id);
                if (!result.ok) throw new Error('回收未完成，已保留当前状态');
              }
            });
            setStatus(
              keepBookmarkId
                ? '已保留所选书签，另一条已移入回收站'
                : '已记录：全部保留'
            );
          } finally {
            database.close();
          }
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '相似项处理失败';
      setReviewError(message);
      setStatus(message);
    } finally {
      setReviewBusy(false);
      await loadReviews();
    }
  };

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
    for (const rows of map.values()) rows.sort((a, b) => (searchScores.get(b.id) ?? 0) - (searchScores.get(a.id) ?? 0) || a.index - b.index);
    return map;
  }, [nodes, searchScores]);
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

  const openOrganizePicker = async () => {
    if (busy || running.current) return;
    setStatus('');
    try {
      const settings = new ChromeSettingsRepository(browser.storage.local);
      const profiles = new ChromeProfileRepository(browser.storage.local);
      const [available, assignments, special, snapshot] = await Promise.all([
        profiles.list(),
        settings.getProfileAssignments(),
        settings.getSpecialFolders(),
        repository.getTree()
      ]);
      const scope = organizationScope(
        snapshot,
        [special.archiveId, special.recycleBinId].filter((id): id is string =>
          Boolean(id)
        )
      );
      const duplicateGroups = groupOrganizationDuplicates(scope.targets);
      setOrganizeScope({
        total: scope.targets.length,
        skipped: scope.skipped,
        duplicates:
          scope.targets.length - duplicateGroups.representatives.length
      });
      const checkpoint = await loadOrganizationCheckpoint(
        browser.storage.local
      );
      const sameLibrary =
        checkpoint?.bookmarkIds.join('\0') ===
        scope.targets.map((node) => node.id).join('\0');
      setOrganizeCheckpoint(sameLibrary ? checkpoint : undefined);
      if (checkpoint && !sameLibrary)
        await clearOrganizationCheckpoint(browser.storage.local);
      if (!scope.targets.length)
        throw new Error('没有可整理的 HTTP/HTTPS 书签');
      const choices = available
        .filter(
          (profile) =>
            profile.state === 'verified' &&
            profile.capabilities.includes('classify')
        )
        .sort((a, b) => (b.verifiedAt ?? 0) - (a.verifiedAt ?? 0));
      const assigned = selectProfileForCapability(
        choices,
        'classify',
        assignments.classify
      );
      const selected = assigned ?? choices[0];
      if (!selected) throw new Error('请先在设置中验证分类模型');
      setOrganizeProfiles(choices);
      setOrganizeProfileKey(modelProfileKey(selected));
      setOrganizePickerOpen(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '模型列表加载失败');
    }
  };
  const run = async (
    action: BatchAction,
    profileKey?: string,
    resume?: Pick<OrganizeProgress, 'batches' | 'folders'>
  ) => {
    if (running.current) return;
    let releaseActivity: () => void;
    try { releaseActivity = await beginBookmarkActivity(); }
    catch (error) { setStatus(error instanceof Error ? error.message : '维护中，请稍后重试'); return; }
    running.current = true;
    setBusy(action);
    setStatus('');
    try {
      if (action === 'organize') {
        if (!resume) setOrganizeProgress(undefined);
        const settings = new ChromeSettingsRepository(browser.storage.local);
        const profiles = new ChromeProfileRepository(browser.storage.local);
        const [available, assignments, special] = await Promise.all([
          profiles.list(),
          settings.getProfileAssignments(),
          settings.getSpecialFolders()
        ]);
        const classifyProfile = profileKey
          ? available.find((profile) => modelProfileKey(profile) === profileKey)
          : selectProfileForCapability(
              available,
              'classify',
              assignments.classify
            );
        if (
          !classifyProfile ||
          classifyProfile.state !== 'verified' ||
          !classifyProfile.capabilities.includes('classify')
        )
          throw new Error('本次整理选择的分类模型不可用');
        const lockedProfile: ModelProfile = {
          ...classifyProfile,
          capabilities: [...classifyProfile.capabilities]
        };
        setOrganizeProfileKey(modelProfileKey(lockedProfile));
        setOrganizeModel(lockedProfile);
        setOrganizeProcessOpen(true);
        setStatus('正在下载完整 HTML 备份，下载完成后生成方案，确认后才移动…');
        const database = openSiftmarkDatabase();
        const specialFolders = new SpecialFolderService(repository, settings);
        const recycle = new RecycleService(
          repository,
          new BookmarkCommandService(
            repository,
            new DexieOperationRepository(database)
          ),
          specialFolders,
          new DexieSpecialFolderPlacementRepository(database)
        );
        const organizationCommands = new BookmarkCommandService(repository, new DexieOperationRepository(database));
        const organizationBatchId = crypto.randomUUID();
        let organizationBatchIndex = 0;
        let undoRemembered = false;
        const rememberOrganizationUndo = async () => {
          if (undoRemembered) return;
          await browser.storage.local.set({ [ORGANIZATION_UNDO_KEY]: organizationBatchId });
          undoRemembered = true;
          setOrganizationUndoBatchId(organizationBatchId);
        };
        try {
          const result = await organizeBookmarks({
            bookmarks: {
              getTree: () => repository.getTree(), get: (id) => repository.get(id),
              create: async (input) => {
                const result = await organizationCommands.create({ ...input, batchId: organizationBatchId, batchIndex: organizationBatchIndex++ });
                if (!result.ok) throw new Error('分类目录创建未完成');
                await rememberOrganizationUndo();
                const created = await repository.get(result.value.bookmarkId);
                if (!created) throw new Error('刚创建的目录已变化，已停止本次移动');
                return created;
              },
              move: async (id, parentId, index) => {
                const current = await repository.get(id);
                if (!current) throw new Error('书签已被删除，保持当前状态');
                const result = await organizationCommands.move({ bookmarkId: id, parentId, index, batchId: organizationBatchId, batchIndex: organizationBatchIndex++, expected: { parentId: current.parentId, index: current.index } });
                if (!result.ok) throw new Error('书签状态已变化，未移动');
                await rememberOrganizationUndo();
                const moved = await repository.get(id);
                if (!moved) throw new Error('书签已被删除');
                return moved;
              }
            },
            planner: new BookmarkOrganizationPlanner(
              createDefaultAiAdapterRegistry(
                new UsageRepository(database),
                organizeConcurrency
              )
            ),
            backup: downloadBookmarkHtml,
            classifyProfile: lockedProfile,
            adaptPlan: async (plan) => applyOrganizationExperience(plan, (await repository.getTree()).filter(isBookmark).map((node) => ({ id: node.id, title: node.title, url: node.url })), await experiences.memories()),
            concurrency: organizeConcurrency,
            resumeBatches: resume?.batches,
            resumeFolders: resume?.folders,
            excludedFolderIds: [special.archiveId, special.recycleBinId].filter(
              (id): id is string => Boolean(id)
            ),
            recordSimilarities: async (pairs, bookmarks, keepers) => {
              const reviews = new OrganizationReviewRepository(database);
              await reviews.record(pairs, bookmarks, keepers);
              setSimilarityRecords(await reviews.list());
            },
            checkRecycle: async () => {
              if (!(await specialFolders.check('recycleBin')).ok)
                throw new Error('请先在设置绑定有效回收站，尚未执行改动');
            },
            recycle: async (bookmark) => {
              const result = await recycle.recycle(bookmark.id);
              if (!result.ok)
                throw new Error('重复项未能移入回收站，已保留当前状态');
            },
            confirm: () =>
              new Promise<boolean | OrganizationApproval>((resolve) => {
                confirmPlan.current = (approved) => {
                  confirmPlan.current = undefined;
                  resolve(approved);
                };
                setOrganizeProcessOpen(true);
              }),
            report: (progress) => {
              setOrganizeProgress(progress);
              setStatus(organizeProgressText(progress));
              const storage = browser.storage.local;
              if (
                progress.stage === 'completed' ||
                progress.stage === 'cancelled'
              ) {
                setOrganizeCheckpoint(undefined);
                void clearOrganizationCheckpoint(storage);
                return;
              }
              // 已完成批次留在本机，重新加载扩展后仍可只重试失败批次。
              // 预览及之后批次结果不再变化；移动阶段每条书签都会上报进度，逐次整份写入会拖慢完成后的清空。
              if (
                !['preview', 'creating', 'moving'].includes(progress.stage) &&
                progress.batches?.some((batch) => batch.status === 'completed')
              ) {
                const next = {
                  version: 1 as const,
                  savedAt: Date.now(),
                  profileKey: modelProfileKey(lockedProfile),
                  concurrency: organizeConcurrency,
                  bookmarkIds: progress.items.map((item) => item.bookmarkId),
                  batches: progress.batches,
                  folders: progress.folders,
                  backupFilename: progress.backupFilename,
                  pipelineError: progress.pipelineError
                };
                setOrganizeCheckpoint(next);
                void saveOrganizationCheckpoint(storage, next);
              }
            }
          });
          setOrganizeProgress(result);
          setStatus(organizeProgressText(result));
        } finally {
          database.close();
        }
      } else if (action === 'sort') {
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
      running.current = false;
      releaseActivity();
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

  const openBookmark = async (node: BookmarkNode & { url: string }) => {
    const startedAt = Date.now();
    await browser.tabs.create({ url: node.url });
    if (query.trim()) await experiences.observe({ id: `search:${crypto.randomUUID()}`, bookmarkId: node.id, kind: 'search', query, occurredAt: Date.now() }, startedAt).catch(() => undefined);
  };
  const moveBookmark = async (sourceId: string, destinationId: string) => {
    const source = nodes.find((node) => node.id === sourceId);
    if (!source || source.parentId === destinationId) return;
    const startedAt = Date.now();
    const batchId = crypto.randomUUID();
    const commands = new BookmarkCommandService(repository, new DexieOperationRepository(learningDatabase));
    const result = await commands.move({ bookmarkId: sourceId, parentId: destinationId, batchId, expected: { parentId: source.parentId, index: source.index } });
    if (!result.ok) { setStatus('书签状态已变化，未移动；请刷新后重试'); return; }
    setManualMove({ batchId, bookmarkId: sourceId, folderId: destinationId });
    await experiences.observe({ id: `move:${batchId}`, bookmarkId: sourceId, kind: 'move', occurredAt: Date.now() }, startedAt).catch(() => undefined);
    await refresh();
  };
  const undoManualMove = async () => {
    if (!manualMove) return;
    const result = await new UndoService(repository, new DexieOperationRepository(learningDatabase)).undoBatch(manualMove.batchId);
    if (result.failed) { setStatus('书签已被其他操作修改，未强行撤销；可刷新后重试'); return; }
    await experiences.observe({ id: `move:${manualMove.batchId}`, bookmarkId: manualMove.bookmarkId, folderId: manualMove.folderId, kind: 'undo', occurredAt: Date.now() }).catch(() => undefined);
    setManualMove(undefined); setStatus('已撤销移动，并撤回对应的正向学习证据'); await refresh();
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
              void moveBookmark(sourceId, node.id).catch((error: unknown) => setStatus(error instanceof Error ? error.message : '移动未完成'));
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
              if (isBookmark(node)) void openBookmark(node);
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

  const openOrganizeProcess = () => {
    setOrganizeProcessOpen(true);
  };
  const selectedOrganizeProfile = organizeProfiles.find(
    (profile) => modelProfileKey(profile) === organizeProfileKey
  );
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
            {query && learningMemories.length > 0 ? <small className="organize-hint" role="status">已结合本地偏好调整搜索顺序；学习记录未上传</small> : null}
            {visibleRoots.map((node) => renderNode(node, 0))}
          </div>
        </section>
        <aside className="bulk-toolbar">
          {manualMove ? <button type="button" onClick={() => void undoManualMove()}>撤销上次移动</button> : null}
          {organizationUndoBatchId ? <button type="button" disabled={Boolean(busy)} onClick={() => {
            void new UndoService(repository, new DexieOperationRepository(learningDatabase)).undoBatch(organizationUndoBatchId).then(async (result) => {
              setStatus(`分类撤销：已还原 ${result.completed} 项，${result.failed} 项因并发改动保留当前状态`);
              if (!result.failed) { await browser.storage.local.remove(ORGANIZATION_UNDO_KEY); setOrganizationUndoBatchId(undefined); setOrganizeProgress(undefined); }
              await refresh();
            }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : '撤销未完成，可重试'));
          }}>撤销本次分类移动</button> : null}
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
            aria-busy={busy === 'organize'}
            disabled={Boolean(busy) || !bookmarks.length}
            onClick={() => void openOrganizePicker()}
          >
            {busy === 'organize' ? (
              <LoaderCircle className="manager-spinner" />
            ) : (
              <FolderInput />
            )}
            备份并整理全部
          </button>
          <small className="organize-hint">
            完整备份 → 生成分类方案 → 确认后移动。保留原标题与网址。
          </small>
          <button
            type="button"
            disabled={
              Boolean(busy) ||
              !similarityRecords.some((record) =>
                ['pending', 'failed'].includes(record.state)
              )
            }
            onClick={() => setReviewOpen(true)}
          >
            <FolderInput />
            审核相似项
          </button>
          {similarityRecords.filter((record) => record.state === 'pending')
            .length ? (
            <small className="organize-hint">
              {
                similarityRecords.filter((record) => record.state === 'pending')
                  .length
              }{' '}
              对相似项待处理，默认全部保留
            </small>
          ) : null}
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
            {busy === 'organize'
              ? status
              : busy
                ? `${actionLabel(busy)}处理中…`
                : status}
          </output>
          {organizeProgress ? (
            <>
              {organizeModel ? (
                <small className="organize-model">
                  本次模型：{organizeModel.name} · {organizeModel.model}
                  <span>{organizeModel.protocol}</span>
                </small>
              ) : null}
              <button
                type="button"
                className="organize-process-button"
                onClick={openOrganizeProcess}
              >
                查看 AI 整理过程
              </button>
              <small className="organize-hint">
                {organizeProgress.backupFilename
                  ? `已备份：${organizeProgress.backupFilename}`
                  : '完整 HTML 备份尚未完成'}
              </small>
              {busy === 'organize' ? (
                <progress
                  aria-label="整理进度"
                  max={organizeProgress.total || 1}
                  value={
                    organizeProgress.stage === 'reading'
                      ? organizeProgress.read
                      : organizeProgress.stage === 'assigning'
                        ? organizeProgress.assigned
                        : organizeProgress.stage === 'moving' ||
                            organizeProgress.stage === 'completed'
                          ? organizeProgress.completed + organizeProgress.failed
                          : undefined
                  }
                />
              ) : null}
              {organizeProgress.errors.length ? (
                <details className="organize-errors">
                  <summary>查看 {organizeProgress.failed} 条失败原因</summary>
                  {organizeProgress.errors.map((error, index) => (
                    <p key={index}>
                      {error.title}：{error.message}
                    </p>
                  ))}
                </details>
              ) : null}
            </>
          ) : null}
        </aside>
      </div>
      <dialog
        ref={pickerRef}
        className="organize-model-dialog"
        aria-labelledby="organize-model-title"
        onCancel={() => setOrganizePickerOpen(false)}
        onClose={() => setOrganizePickerOpen(false)}
      >
        <header>
          <div>
            <h2 id="organize-model-title">生成全量分类方案</h2>
            <p>确认方案之前，不创建目录、不移动书签。</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭模型选择"
            onClick={() => setOrganizePickerOpen(false)}
          >
            <X size={18} />
          </button>
        </header>
        <div className="organize-model-body">
        <dl className="organize-scope">
          <div>
            <dt>本次范围</dt>
            <dd>全部可整理书签 · {organizeScope.total} 条</dd>
          </div>
          {organizeScope.duplicates ? (
            <div>
              <dt>同 URL 副本</dt>
              <dd>{organizeScope.duplicates} 条 · 分析合并，确认方案后回收</dd>
            </div>
          ) : null}
          <div>
            <dt>安全跳过</dt>
            <dd>{organizeScope.skipped} 条（归档、回收站或非 HTTP/HTTPS）</dd>
          </div>
          <div>
            <dt>目录位置</dt>
            <dd>书签栏下，最多三级；旧目录不删除</dd>
          </div>
        </dl>
        <div className="organize-concurrency-control">
          <span id="organize-concurrency-label">并发批次</span>
          <div role="radiogroup" aria-labelledby="organize-concurrency-label">
            {[1, 2, 3, 4].map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={organizeConcurrency === count}
                data-selected={organizeConcurrency === count}
                onClick={() => setOrganizeConcurrency(count)}
              >
                {count}
                {count === 2 ? ' 推荐' : ''}
              </button>
            ))}
          </div>
        </div>
        {organizeCheckpoint ? (
          <p className="organize-data-notice">
            上次分析已完成部分批次，书签尚未移动。可以只重试失败批次。
          </p>
        ) : null}
        <div
          className="organize-model-list"
          role="group"
          aria-label="本次分类模型"
        >
          {organizeProfiles.map((profile) => {
            const key = modelProfileKey(profile);
            return (
              <label key={key} data-selected={key === organizeProfileKey}>
                <input
                  type="radio"
                  name="organize-model"
                  value={key}
                  checked={key === organizeProfileKey}
                  onChange={() => setOrganizeProfileKey(key)}
                />
                <span className="organize-model-main">
                  <strong>{profile.name}</strong>
                  <small>{profile.model}</small>
                  <span className="organize-model-meta">
                    连接已验证 · 支持分类
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="organize-data-notice">
          书签标题与脱敏网址将分批发送至所选模型服务（
          {selectedOrganizeProfile
            ? safeDomain(selectedOrganizeProfile.endpoint)
            : ''}
          ），不读取网页正文或发送私密笔记。分析会使用模型额度；取消方案不能撤回已发送的数据。
        </p>
        <p className="organize-data-notice">
          本次模型配置固定，不修改全局默认。先下载完整 HTML
          备份，再生成方案，最后由你确认是否移动。
        </p>
        </div>
        <footer>
          <button type="button" onClick={() => setOrganizePickerOpen(false)}>
            取消
          </button>
          {organizeCheckpoint ? (
            <button
              type="button"
              onClick={() => {
                setOrganizePickerOpen(false);
                void run('organize', organizeCheckpoint.profileKey, {
                  batches: organizeCheckpoint.batches,
                  folders: organizeCheckpoint.folders
                });
              }}
            >
              继续上次失败的批次
            </button>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={!selectedOrganizeProfile}
            onClick={() => {
              setOrganizePickerOpen(false);
              void run('organize', organizeProfileKey);
            }}
          >
            <Save size={16} />
            备份并生成方案
          </button>
        </footer>
      </dialog>
      {reviewOpen ? (
        <OrganizationReviewDialog
          records={similarityRecords}
          busy={reviewBusy}
          error={reviewError}
          onClose={() => setReviewOpen(false)}
          onResolve={resolveReview}
        />
      ) : null}
      {organizeProcessOpen && organizeProgress ? (
        <OrganizationProcessDialog
          progress={organizeProgress}
          model={organizeModel}
          onClose={() => setOrganizeProcessOpen(false)}
          similarityRecords={similarityRecords}
          onReviewSimilarities={() => {
            setOrganizeProcessOpen(false);
            setReviewOpen(true);
          }}
          onConfirm={(approved) => confirmPlan.current?.(approved)}
          onRetry={
            busy
              ? undefined
              : () => {
                  setOrganizeProcessOpen(false);
                  void openOrganizePicker();
                }
          }
          onRetryFailed={
            busy
              ? undefined
              : () => {
                  if (!organizeProgress) return;
                  void run('organize', organizeProfileKey, {
                    batches: organizeProgress.batches,
                    folders: organizeProgress.folders
                  });
                }
          }
        />
      ) : null}
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
    organize: '全部整理',
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
