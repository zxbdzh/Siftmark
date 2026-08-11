import { AnalysisCoordinator } from '../src/ai/analysis-coordinator';
import { createDefaultAiAdapterRegistry } from '../src/ai/create-adapter-registry';
import { DexieProposalRepository } from '../src/ai/proposal';
import { ChromeProfileRepository } from '../src/ai/profiles/profile-repository';
import { ChromeBookmarkRepository } from '../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../src/platform/chrome/chrome-types';
import { registerBrowserCommands } from '../src/platform/chrome/commands';
import {
  contextMenuIds,
  registerContextMenus
} from '../src/platform/chrome/context-menus';
import { RuleEngine } from '../src/rules/rule-engine';
import { ChromeSettingsRepository } from '../src/settings/settings-repository';
import { openSiftmarkDatabase } from '../src/storage/database';
import { DexieTaskRepository } from '../src/tasks/task-repository';
import { recoverInterruptedTasks } from '../src/tasks/task-recovery';
import { TaskRunner } from '../src/tasks/task-runner';
import type { TaskHandler } from '../src/tasks/types';
import { logger } from '../src/utils/logger';
import { ChromeNoteDraftRepository } from '../src/notes/draft-repository';
import { DexieThumbnailRepository } from '../src/storage/thumbnail-repository';
import { ThumbnailService } from '../src/capture/thumbnail-service';
import {
  createCaptureThumbnailHandler,
  type CaptureThumbnailInput
} from '../src/tasks/handlers/capture-thumbnail';
import type { PageCapture } from '../src/capture/types';
import { captureAgentScreenshot } from '../src/capture/agent-screenshot';
import { EmbeddingRepository } from '../src/search/embedding/embedding-repository';
import { EmbeddingIndexer } from '../src/search/embedding/embedding-indexer';
import {
  createIndexEmbeddingsHandler,
  type IndexEmbeddingsInput
} from '../src/tasks/handlers/index-embeddings';
import { buildSearchDocuments } from '../src/search/build-search-documents';
import { DexieMetadataRepository } from '../src/storage/metadata-repository';
import { LinkChecker } from '../src/health/link-checker';
import { HealthScanService } from '../src/health/health-scan-service';
import {
  createScanHealthHandler,
  type ScanHealthInput
} from '../src/tasks/handlers/scan-health';
import {
  ChromeHealthScheduler,
  HEALTH_SCAN_ALARM,
  type HealthSchedule
} from '../src/platform/chrome/scheduler';
import { NotificationRepository } from '../src/notifications/notification-repository';
import { NotificationService } from '../src/notifications/notification-service';
import { ChromeBrowserNotifications } from '../src/platform/chrome/browser-notifications';
import { VisitAggregator } from '../src/health/visit-aggregator';
import { normalizeUrlConservatively } from '../src/health/url-normalization';
import notificationIcon from '../assets/icons/siftmark-128.png?url';
import { DexieOperationRepository } from '../src/operations/operation-repository';
import { BookmarkCommandService } from '../src/operations/bookmark-command-service';
import {
  applyImportPlan,
  DexieImportRecoveryRepository
} from '../src/backup/import-application-service';
import { DexieSpecialFolderPlacementRepository } from '../src/bookmarks/placement-repository';
import { SpecialFolderService } from '../src/bookmarks/special-folders';
import { createPurgeRecycleBinHandler } from '../src/tasks/handlers/purge-recycle-bin';
import { ChromeSmartBookmarkHistoryRepository } from '../src/bookmarks/history-repository';
import { SmartBookmarkService } from '../src/bookmarks/smart-bookmark-service';
import { UsageRepository } from '../src/ai/network/usage-repository';
import {
  CaptureAgent,
  DexieCapturePreferenceRepository,
  DexieCaptureSessionRepository,
  LocalCaptureExecutor,
  SmartCapturePlanner,
  type CaptureAgentAction,
  type CaptureSession,
  type CaptureTrigger
} from '../src/capture-agent';
import { UndoService } from '../src/operations/undo-service';

const TASK_WAKE_ALARM = 'siftmark-task-wake';
const RECYCLE_PURGE_ALARM = 'siftmark-recycle-purge';
const VISIT_TRACKING_KEY = 'siftmark.visits.enabled.v1';
const ACTIVE_CAPTURE_SESSION_KEY = 'siftmark.capture-agent.active-session.v1';

interface AnalyzeTaskInput {
  bookmarkId: string;
  tabId?: number;
  taskId?: string;
}

interface RuntimeMessageInput {
  action?: 'allow' | 'reject' | 'adjust' | 'undo' | 'retry' | 'message';
  bookmarkId?: string;
  bookmarkIds?: string[];
  folderId?: string;
  tabId?: number;
  taskId?: string;
  sessionId?: string;
  message?: string;
  title?: string;
  url?: string;
  windowId?: number;
}

export default defineBackground(() => {
  const database = openSiftmarkDatabase();
  const tasks = new DexieTaskRepository(database);
  const runner = new TaskRunner(tasks);
  const bookmarks = new ChromeBookmarkRepository(
    browser.bookmarks as unknown as ChromeBookmarkApi
  );
  const profiles = new ChromeProfileRepository(browser.storage.local);
  const settings = new ChromeSettingsRepository(browser.storage.local);
  const proposals = new DexieProposalRepository(database);
  const metadata = new DexieMetadataRepository(database);
  const operations = new DexieOperationRepository(database);
  const bookmarkCommands = new BookmarkCommandService(
    bookmarks,
    operations,
    metadata
  );
  const specialFolders = new SpecialFolderService(bookmarks, settings);
  const specialFolderPlacements = new DexieSpecialFolderPlacementRepository(
    database
  );
  const undo = new UndoService(
    bookmarks,
    operations,
    metadata,
    Date.now,
    specialFolderPlacements
  );
  const importRecoveryPoints = new DexieImportRecoveryRepository(database);
  const usage = new UsageRepository(database);
  const adapters = createDefaultAiAdapterRegistry(usage);
  const captureSessions = new DexieCaptureSessionRepository(database);
  const capturePreferences = new DexieCapturePreferenceRepository(database);
  const smartHistory = new ChromeSmartBookmarkHistoryRepository(
    browser.storage.local
  );
  const publishCaptureSession = async (
    session: CaptureSession,
    tabId?: number
  ) => {
    await browser.storage.local
      .set({ [ACTIVE_CAPTURE_SESSION_KEY]: session.id })
      .catch(() => undefined);
    if (session.state === 'applied' && session.plan) {
      try {
        const current = await bookmarks.get(session.bookmarkId);
        await smartHistory.add({
          id: session.id,
          bookmarkId: session.bookmarkId,
          title: session.plan.title,
          url: current?.url ?? session.sourceSnapshot.url ?? '',
          category: [
            ...session.plan.destination.path.map((folder) => folder.title),
            ...session.plan.destination.newFolders
          ].join('/'),
          timestamp: session.resolvedAt ?? session.updatedAt
        });
      } catch {
        // History is auxiliary; session updates must still reach the UI.
      }
    }
    if (tabId !== undefined)
      await browser.tabs
        .sendMessage(tabId, {
          type: 'capture-agent-session-changed',
          session
        })
        .catch(() => undefined);
    void browser.runtime
      .sendMessage({
        type: 'capture-agent-sessions-changed',
        sessionId: session.id
      })
      .catch(() => undefined);
  };
  const captureSessionTabs = new Map<string, number>();
  const captureBookmarkTabs = new Map<string, number>();
  const capturePlanner = new SmartCapturePlanner({
    bookmarks,
    profiles,
    settings,
    adapters,
    metadata
  });
  const captureExecutor = new LocalCaptureExecutor({
    bookmarks,
    commands: bookmarkCommands,
    metadata,
    specialFolders,
    undo
  });
  const captureAgent = new CaptureAgent({
    bookmarks,
    sessions: captureSessions,
    preferences: capturePreferences,
    planner: capturePlanner,
    executor: captureExecutor,
    onSessionChanged: async (session) => {
      const tabId =
        captureSessionTabs.get(session.id) ??
        captureBookmarkTabs.get(session.bookmarkId);
      if (tabId !== undefined) captureSessionTabs.set(session.id, tabId);
      await publishCaptureSession(session, tabId);
    },
    getSpecialFolderIds: async () => {
      const configured = await settings.getSpecialFolders();
      return [
        configured.inboxId,
        configured.archiveId,
        configured.recycleBinId
      ].filter((id): id is string => Boolean(id));
    }
  });
  const smartBookmarks = new SmartBookmarkService(
    bookmarks,
    profiles,
    settings,
    adapters,
    smartHistory,
    metadata
  );
  const captureOwnedUrls = new Set<string>();
  const noteDrafts = new ChromeNoteDraftRepository(browser.storage.local);
  const thumbnailRepository = new DexieThumbnailRepository(database);
  const thumbnailService = new ThumbnailService(
    {
      captureVisibleTab: (windowId, options) =>
        browser.tabs.captureVisibleTab(windowId, options)
    },
    thumbnailRepository
  );
  const embeddingIndexer = new EmbeddingIndexer(
    new EmbeddingRepository(database)
  );
  const healthScanService = new HealthScanService(
    new LinkChecker(),
    metadata,
    proposals
  );
  const healthScheduler = new ChromeHealthScheduler(
    browser.alarms,
    browser.storage.local
  );
  const notificationService = new NotificationService(
    new NotificationRepository(database),
    new ChromeBrowserNotifications(
      browser.permissions,
      browser.notifications,
      notificationIcon
    )
  );
  const visitAggregator = new VisitAggregator(database);

  const enqueueAnalysis = async (
    input: AnalyzeTaskInput & { taskId?: string }
  ) => {
    const now = Date.now();
    const taskId = input.taskId ?? crypto.randomUUID();
    await tasks.put({
      id: taskId,
      type: 'analyze-bookmark',
      state: 'queued',
      input: { bookmarkId: input.bookmarkId, tabId: input.tabId },
      completed: 0,
      failed: 0,
      retryCount: 0,
      idempotencyKey: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    });
    void runner.runUntilIdle();
    return { taskId };
  };
  const enqueueThumbnail = async (input: {
    bookmarkId: string;
    tabId?: number;
    windowId?: number;
  }) => {
    const now = Date.now();
    const taskId = crypto.randomUUID();
    await tasks.put({
      id: taskId,
      type: 'capture-thumbnail',
      state: 'queued',
      input,
      completed: 0,
      failed: 0,
      retryCount: 0,
      idempotencyKey: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    });
    void runner.runUntilIdle();
    return { taskId };
  };
  const enqueueConfiguredEmbeddings = async (bookmarkIds?: string[]) => {
    const assignment = (await settings.getProfileAssignments()).embed;
    if (!assignment) return undefined;
    const separator = assignment.lastIndexOf('@');
    if (separator <= 0) return undefined;
    const profileId = assignment.slice(0, separator);
    const profileVersion = assignment.slice(separator + 1);
    const taskId = `embedding-index:${assignment}`;
    const existing = await tasks.get(taskId);
    if (existing && ['queued', 'running', 'paused'].includes(existing.state))
      return { taskId };
    const now = Date.now();
    const input: IndexEmbeddingsInput = {
      profileId,
      profileVersion,
      ...(bookmarkIds ? { bookmarkIds } : {})
    };
    await tasks.put({
      id: taskId,
      type: 'index-embeddings',
      state: 'queued',
      input,
      profileVersion,
      completed: 0,
      failed: 0,
      retryCount: 0,
      idempotencyKey: `embedding:${assignment}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    void runner.runUntilIdle();
    return { taskId };
  };
  const enqueueHealthScan = async (input: ScanHealthInput = {}) => {
    const now = Date.now();
    const taskId = crypto.randomUUID();
    await tasks.put({
      id: taskId,
      type: 'scan-health',
      state: 'queued',
      input,
      completed: 0,
      failed: 0,
      retryCount: 0,
      idempotencyKey: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    });
    void runner.runUntilIdle();
    return { taskId };
  };
  const runLegacySmartBookmark = async (input: {
    tabId?: number;
    url: string;
    title: string;
    bookmarkId?: string;
  }) => {
    captureOwnedUrls.add(input.url);
    try {
      const capture = input.tabId
        ? ((await browser.tabs
            .sendMessage(input.tabId, { type: 'capture-page' })
            .catch(() => undefined)) as PageCapture | undefined)
        : undefined;
      const result = await smartBookmarks.save({
        ...input,
        description: capture?.description,
        pageText: capture?.text
      });
      void browser.runtime
        .sendMessage({ type: 'smart-bookmark-history-changed' })
        .catch(() => undefined);
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '智能收藏失败'
      };
    } finally {
      globalThis.setTimeout(() => captureOwnedUrls.delete(input.url), 10_000);
    }
  };
  const findActiveTabForUrl = async (url: string) => {
    const tabs = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    const target = normalizeUrlConservatively(url);
    return tabs.find(
      (tab) =>
        tab.id !== undefined &&
        tab.url !== undefined &&
        normalizeUrlConservatively(tab.url) === target
    );
  };
  const pageCaptureForTab = async (tabId?: number) => {
    if (tabId === undefined) return undefined;
    const stored = await browser.storage.local.get(null);
    const blockedDomains = Object.entries(stored)
      .filter(
        ([key, value]) =>
          key.startsWith('siftmark.content.hidden.') && value === true
      )
      .map(([key]) => key.slice('siftmark.content.hidden.'.length));
    return (await browser.tabs
      .sendMessage(tabId, { type: 'capture-page', blockedDomains })
      .catch(() => undefined)) as PageCapture | undefined;
  };
  const screenshotForCapture = async (
    tabId: number | undefined,
    page: PageCapture | undefined
  ) => {
    if (tabId === undefined || page?.policy.screenshot !== 'allowed')
      return undefined;
    const smartSettings = await settings.getSmartBookmarkSettings();
    if (!smartSettings.enableVision) return undefined;
    return captureAgentScreenshot(
      {
        getTab: (id) => browser.tabs.get(id).catch(() => undefined),
        getActiveTab: (windowId) =>
          browser.tabs.query({ active: true, windowId }).then(([tab]) => tab),
        captureVisibleTab: (windowId, options) =>
          browser.tabs.captureVisibleTab(windowId, options)
      },
      { tabId, screenshotAllowed: true }
    );
  };
  const processCapturedBookmark = async (input: {
    bookmarkId: string;
    tabId?: number;
    trigger: CaptureTrigger;
    page?: PageCapture;
  }) => {
    if (input.tabId !== undefined)
      captureBookmarkTabs.set(input.bookmarkId, input.tabId);
    if (input.tabId !== undefined)
      await browser.tabs
        .sendMessage(input.tabId, {
          type: 'capture-agent-overlay',
          view: { phase: 'processing' }
        })
        .catch(() => undefined);
    try {
      const page = input.page ?? (await pageCaptureForTab(input.tabId));
      const imageDataUrl = await screenshotForCapture(input.tabId, page);
      const session = await captureAgent.begin({
        bookmarkId: input.bookmarkId,
        trigger: input.trigger,
        ...(page || imageDataUrl
          ? {
              page: {
                description: page?.description,
                text: page?.text,
                ...(imageDataUrl ? { imageDataUrl } : {})
              }
            }
          : {})
      });
      if (input.tabId !== undefined)
        captureSessionTabs.set(session.id, input.tabId);
      return { success: session.state !== 'failed', session };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '收藏 Agent 处理失败';
      if (input.tabId !== undefined)
        await browser.tabs
          .sendMessage(input.tabId, {
            type: 'capture-agent-overlay',
            view: { phase: 'error', message }
          })
          .catch(() => undefined);
      return { success: false, error: message };
    } finally {
      captureBookmarkTabs.delete(input.bookmarkId);
    }
  };
  const initialCaptureFolderId = async () => {
    const inbox = await specialFolders.check('inbox');
    if (inbox.ok) return inbox.folder.id;
    const nodes = await bookmarks.getTree();
    const roots = nodes.filter((node) => node.parentId === '0' && !node.url);
    const preferred = roots.find((node) =>
      /书签栏|收藏夹栏|bookmarks bar|favorites bar/i.test(node.title)
    );
    const root = preferred ?? roots[0];
    if (!root) throw new Error('未找到浏览器书签栏');
    return root.id;
  };
  const saveUrlWithAgent = async (input: {
    url: string;
    title: string;
    trigger: CaptureTrigger;
    tabId?: number;
  }) => {
    if (!isSupportedCaptureUrl(input.url))
      return { success: false, error: '当前页面不支持收藏' };
    captureOwnedUrls.add(input.url);
    try {
      const bookmark = await bookmarks.create({
        parentId: await initialCaptureFolderId(),
        index: 0,
        title: input.title,
        url: input.url
      });
      return processCapturedBookmark({
        bookmarkId: bookmark.id,
        tabId: input.tabId,
        trigger: input.trigger
      });
    } finally {
      globalThis.setTimeout(() => captureOwnedUrls.delete(input.url), 10_000);
    }
  };
  const saveActiveTab = async (
    trigger: CaptureTrigger = 'keyboard-command'
  ) => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab?.url) return { success: false, error: '无法读取当前页面' };
    return saveUrlWithAgent({
      tabId: tab.id,
      url: tab.url,
      title: tab.title || tab.url,
      trigger
    });
  };
  const openCaptureAgent = async (sessionId: string, tabId?: number) => {
    await browser.storage.local.set({
      [ACTIVE_CAPTURE_SESSION_KEY]: sessionId
    });
    const targetTabId =
      tabId ??
      (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
        ?.id;
    const sidePanel = (
      browser as unknown as {
        sidePanel?: {
          setOptions(options: {
            tabId?: number;
            path: string;
            enabled: boolean;
          }): Promise<void>;
          open(options: { tabId?: number; windowId?: number }): Promise<void>;
        };
      }
    ).sidePanel;
    try {
      if (!sidePanel) throw new Error('Side Panel unavailable');
      if (targetTabId !== undefined)
        await sidePanel.setOptions({
          tabId: targetTabId,
          path: 'sidepanel.html',
          enabled: true
        });
      await sidePanel.open(
        targetTabId !== undefined ? { tabId: targetTabId } : {}
      );
      return { success: true };
    } catch {
      await browser.tabs.create({
        url: `${browser.runtime.getURL('/sidepanel.html')}?session=${encodeURIComponent(sessionId)}`
      });
      return { success: true, fallback: true };
    }
  };
  const respondToCapture = async (
    input: RuntimeMessageInput,
    tabId?: number
  ) => {
    if (!input.sessionId || !input.action)
      return { success: false, error: '收藏任务参数不完整' };
    if (input.action === 'adjust')
      return openCaptureAgent(input.sessionId, tabId);
    let action: CaptureAgentAction;
    if (input.action === 'message')
      action = { type: 'message', message: input.message ?? '' };
    else if (input.action === 'retry') {
      const page = await pageCaptureForTab(tabId);
      const imageDataUrl = await screenshotForCapture(tabId, page);
      action = {
        type: 'retry',
        ...(page || imageDataUrl
          ? {
              page: {
                description: page?.description,
                text: page?.text,
                ...(imageDataUrl ? { imageDataUrl } : {})
              }
            }
          : {})
      };
    } else action = { type: input.action };
    try {
      if (tabId !== undefined) captureSessionTabs.set(input.sessionId, tabId);
      const session = await captureAgent.respond(input.sessionId, action);
      return { success: true, session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '操作未完成'
      };
    }
  };

  const analyzeHandler: TaskHandler<AnalyzeTaskInput> = async ({
    task,
    signal,
    reportProgress
  }) => {
    const snapshot = await bookmarks.get(task.input.bookmarkId);
    if (!snapshot?.url) return { state: 'failed', failed: task.failed + 1 };
    await reportProgress({ completed: 0, failed: 0 });
    if (signal.aborted) return { state: 'cancelled' };
    const [availableProfiles, rules, promptRules, assignments] =
      await Promise.all([
        profiles.list(),
        settings.getRules(),
        settings.getPromptRules(),
        settings.getProfileAssignments()
      ]);
    const coordinator = new AnalysisCoordinator({
      bookmarks,
      profiles: availableProfiles,
      adapters,
      proposals,
      rules: new RuleEngine(rules)
    });
    await coordinator.analyze(
      snapshot,
      {
        title: snapshot.title,
        url: snapshot.url,
        currentFolderPath: [snapshot.parentId],
        additionalRules: promptRules || undefined,
        taskType: 'classify'
      },
      assignments
    );
    await reportProgress({ completed: 1, failed: 0 });
    return { state: 'succeeded', completed: 1 };
  };
  runner.register('analyze-bookmark', analyzeHandler);
  runner.register(
    'capture-thumbnail',
    createCaptureThumbnailHandler(
      thumbnailService,
      async (input: CaptureThumbnailInput) => {
        const bookmark = await bookmarks.get(input.bookmarkId);
        const requestedTab =
          input.tabId === undefined
            ? undefined
            : await browser.tabs.get(input.tabId).catch(() => undefined);
        const [activeTab] = await browser.tabs.query({
          active: true,
          ...(requestedTab?.windowId !== undefined
            ? { windowId: requestedTab.windowId }
            : { currentWindow: true })
        });
        const tab = requestedTab ?? activeTab;
        const sameTab = Boolean(
          tab?.id !== undefined && activeTab?.id === tab.id
        );
        const sameUrl = Boolean(bookmark?.url && tab?.url === bookmark.url);
        let capture: PageCapture | undefined;
        if (sameTab && sameUrl && tab?.id !== undefined)
          capture = (await browser.tabs
            .sendMessage(tab.id, { type: 'capture-page' })
            .catch(() => undefined)) as PageCapture | undefined;
        return {
          ...input,
          tabId: tab?.id,
          activeTabId: activeTab?.id,
          windowId: tab?.windowId,
          screenshotAllowed:
            sameTab && sameUrl && capture?.policy.screenshot === 'allowed'
        };
      }
    )
  );
  runner.register(
    'index-embeddings',
    createIndexEmbeddingsHandler({
      profiles,
      adapters,
      indexer: embeddingIndexer,
      loadDocuments: async (bookmarkIds) => {
        const [nodes, metadataRows, visitRows] = await Promise.all([
          bookmarks.getTree(),
          database.bookmarkMetadata.toArray(),
          database.visitAggregates.toArray()
        ]);
        const filter = bookmarkIds ? new Set(bookmarkIds) : undefined;
        return buildSearchDocuments(
          nodes,
          new Map(metadataRows.map((row) => [row.bookmarkId, row])),
          new Map(
            visitRows.map((row) => [row.bookmarkId, row.lastVisitedAt ?? 0])
          )
        ).filter((document) => !filter || filter.has(document.bookmarkId));
      }
    })
  );
  const scanHealthHandler = createScanHealthHandler(healthScanService, () =>
    bookmarks.getTree()
  );
  runner.register<ScanHealthInput>('scan-health', async (context) => {
    const result = await scanHealthHandler(context);
    if (
      result.state === 'succeeded' ||
      result.state === 'paused' ||
      result.state === 'failed'
    ) {
      await notificationService.notify({
        type:
          result.state === 'succeeded'
            ? 'task-succeeded'
            : result.state === 'paused'
              ? 'task-paused'
              : 'task-failed',
        title: '健康检查',
        message: `${result.completed ?? context.task.completed} 个项目${result.state === 'succeeded' ? '已检查' : result.state === 'paused' ? '等待继续' : '检查失败'}`,
        taskId: context.task.id,
        browserSummary: {
          state: result.state,
          count: result.completed ?? context.task.completed
        }
      });
      void browser.runtime
        .sendMessage({ type: 'notifications-changed' })
        .catch(() => undefined);
    }
    return result;
  });
  runner.register('backup-import', async ({ task }) => {
    const result = await applyImportPlan(task.id, {
      bookmarks,
      commands: bookmarkCommands,
      metadata,
      tasks,
      recoveryPoints: importRecoveryPoints,
      configuration: browser.storage.local
    });
    return {
      state: result.state === 'succeeded' ? 'succeeded' : 'paused',
      completed: result.completed,
      failed: result.failed
    };
  });
  runner.register(
    'purge-recycle-bin',
    createPurgeRecycleBinHandler({
      bookmarks,
      placements: specialFolderPlacements,
      specialFolders,
      metadata
    })
  );

  const enqueueRecyclePurge = async () => {
    const now = Date.now();
    const taskId = crypto.randomUUID();
    await tasks.put({
      id: taskId,
      type: 'purge-recycle-bin',
      state: 'queued',
      input: {},
      completed: 0,
      failed: 0,
      retryCount: 0,
      idempotencyKey: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    });
    void runner.runUntilIdle();
    return { taskId };
  };

  const processTasks = async () => {
    await recoverInterruptedTasks(tasks, Date.now());
    await captureSessions.expirePending(Date.now());
    await runner.runUntilIdle();
  };
  void processTasks();
  void enqueueConfiguredEmbeddings();
  void healthScheduler.restore();
  void visitAggregator.prune(Date.now());
  browser.runtime.onInstalled.addListener(() => {
    logger.info('扩展已安装');
    void browser.alarms.create(TASK_WAKE_ALARM, { periodInMinutes: 1 });
    void browser.alarms.create(RECYCLE_PURGE_ALARM, {
      periodInMinutes: 24 * 60
    });
    void registerContextMenus(browser.contextMenus);
  });
  registerBrowserCommands(browser.commands, () => void saveActiveTab());
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: { tab?: { id?: number } }) => {
      const value = message as {
        type?: string;
        input?: RuntimeMessageInput;
      };
      if (value.type === 'capture-agent-list') return captureSessions.list(30);
      if (value.type === 'capture-agent-list-pending')
        return captureSessions.listPending(100);
      if (value.type === 'capture-agent-get' && value.input?.sessionId)
        return captureSessions.get(value.input.sessionId);
      if (value.type === 'capture-agent-get-active')
        return browser.storage.local
          .get(ACTIVE_CAPTURE_SESSION_KEY)
          .then(async (stored) => {
            const sessionId = stored[ACTIVE_CAPTURE_SESSION_KEY];
            return typeof sessionId === 'string'
              ? captureSessions.get(sessionId)
              : null;
          });
      if (value.type === 'capture-agent-action' && value.input)
        return respondToCapture(value.input, sender.tab?.id);
      if (value.type === 'queue-analysis' && value.input?.bookmarkId)
        return enqueueAnalysis({
          bookmarkId: value.input.bookmarkId,
          tabId: value.input.tabId,
          taskId: value.input.taskId
        });
      if (value.type === 'queue-thumbnail' && value.input?.bookmarkId)
        return enqueueThumbnail({
          bookmarkId: value.input.bookmarkId,
          tabId: value.input.tabId,
          windowId: value.input.windowId
        });
      if (value.type === 'queue-embeddings')
        return enqueueConfiguredEmbeddings(
          value.input?.bookmarkId ? [value.input.bookmarkId] : undefined
        );
      if (value.type === 'queue-health-scan')
        return enqueueHealthScan(
          value.input?.folderId ? { folderId: value.input.folderId } : {}
        );
      if (value.type === 'queue-recycle-purge') return enqueueRecyclePurge();
      if (value.type === 'configure-health-schedule' && value.input)
        return healthScheduler.configure(
          value.input as unknown as HealthSchedule
        );
      if (value.type === 'save-current-page') return saveActiveTab();
      if (value.type === 'smart-bookmark' && value.input?.url)
        return saveUrlWithAgent({
          tabId: value.input.tabId,
          url: value.input.url,
          title: value.input.title || value.input.url,
          trigger: 'popup'
        });
      if (value.type === 'bulk-classify') {
        return (async () => {
          const results = [];
          for (const bookmarkId of value.input?.bookmarkIds ?? []) {
            const bookmark = await bookmarks.get(bookmarkId);
            results.push(
              bookmark?.url
                ? await runLegacySmartBookmark({
                    bookmarkId,
                    url: bookmark.url,
                    title: bookmark.title
                  })
                : { success: false, error: '书签不存在' }
            );
          }
          return results;
        })();
      }
      if (value.type === 'bulk-rename')
        return Promise.all(
          (value.input?.bookmarkIds ?? []).map(async (bookmarkId) => {
            try {
              return {
                success: true,
                ...(await smartBookmarks.rename(bookmarkId))
              };
            } catch (error) {
              return {
                success: false,
                bookmarkId,
                error: error instanceof Error ? error.message : '智能重命名失败'
              };
            }
          })
        );
      if (value.type === 'bulk-health')
        return (async () => {
          const bookmarkIds = value.input?.bookmarkIds ?? [];
          const selected = (
            await Promise.all(bookmarkIds.map((id) => bookmarks.get(id)))
          ).filter((node): node is NonNullable<typeof node> =>
            Boolean(node?.url)
          );
          const results = await new LinkChecker().checkMany(
            selected.map((node) => node.url!)
          );
          for (const [index, node] of selected.entries()) {
            const current = await metadata.get(node.id);
            await metadata.put({
              bookmarkId: node.id,
              summary: current?.summary ?? '',
              tags: current?.tags ?? [],
              note: current?.note ?? '',
              confidence: current?.confidence ?? 'unknown',
              reason: current?.reason ?? '',
              health: results[index]?.status ?? 'unchecked',
              updatedAt: Date.now()
            });
          }
          return selected.map((node, index) => ({
            success: true,
            bookmarkId: node.id,
            status: results[index]?.status ?? 'unchecked'
          }));
        })();
    }
  );
  browser.bookmarks.onCreated.addListener((id, bookmark) => {
    if (!bookmark.url || captureOwnedUrls.has(bookmark.url)) return;
    void settings.getSmartBookmarkSettings().then(async (preference) => {
      if (!preference.captureNativeBookmarks) return;
      const tab = await findActiveTabForUrl(bookmark.url!);
      await processCapturedBookmark({
        bookmarkId: id,
        tabId: tab?.id,
        trigger: 'native-bookmark'
      });
    });
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === contextMenuIds[3])
      void browser.tabs.create({
        url: browser.runtime.getURL('/manager.html')
      });
    else if (info.menuItemId === contextMenuIds[2] && info.selectionText) {
      const text = info.selectionText.slice(0, 2_000);
      const id = crypto.randomUUID();
      void noteDrafts.put({
        id,
        text,
        title: tab?.title ?? '',
        url: tab?.url ?? '',
        createdAt: Date.now(),
        truncated: info.selectionText.length > text.length
      });
    } else if (info.menuItemId === contextMenuIds[0])
      void saveActiveTab('context-menu');
    else if (info.menuItemId === contextMenuIds[1] && info.linkUrl)
      void saveUrlWithAgent({
        url: info.linkUrl,
        title: info.linkUrl,
        tabId: tab?.id,
        trigger: 'context-menu'
      });
  });
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    void browser.storage.local.get(VISIT_TRACKING_KEY).then(async (stored) => {
      if (stored[VISIT_TRACKING_KEY] !== true) return;
      const target = normalizeUrlConservatively(tab.url!);
      const matches = (await bookmarks.getTree()).filter(
        (node) => node.url && normalizeUrlConservatively(node.url) === target
      );
      await Promise.all(
        matches.map((bookmark) =>
          visitAggregator.record(bookmark.id, Date.now())
        )
      );
      if (matches.length > 0)
        void browser.runtime
          .sendMessage({ type: 'visits-changed' })
          .catch(() => undefined);
    });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TASK_WAKE_ALARM) void runner.runUntilIdle();
    else if (alarm.name === RECYCLE_PURGE_ALARM) void enqueueRecyclePurge();
    else if (alarm.name === HEALTH_SCAN_ALARM)
      void healthScheduler.getSchedule().then(async (schedule) => {
        if (!schedule.enabled) return;
        if (schedule.folderIds.length === 0) await enqueueHealthScan();
        else
          for (const folderId of schedule.folderIds)
            await enqueueHealthScan({ folderId });
      });
  });
});

function isSupportedCaptureUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
