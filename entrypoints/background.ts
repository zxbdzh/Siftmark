import { AnalysisCoordinator } from '../src/ai/analysis-coordinator';
import { createDefaultAiAdapterRegistry } from '../src/ai/create-adapter-registry';
import { DexieProposalRepository } from '../src/ai/proposal';
import { ChromeProfileRepository } from '../src/ai/profiles/profile-repository';
import { SaveService } from '../src/bookmarks/save-service';
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

const TASK_WAKE_ALARM = 'siftmark-task-wake';
const RECYCLE_PURGE_ALARM = 'siftmark-recycle-purge';
const VISIT_TRACKING_KEY = 'siftmark.visits.enabled.v1';

interface AnalyzeTaskInput {
  bookmarkId: string;
  tabId?: number;
  taskId?: string;
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
  const importRecoveryPoints = new DexieImportRecoveryRepository(database);
  const adapters = createDefaultAiAdapterRegistry();
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
  const saveService = new SaveService(bookmarks, { enqueue: enqueueAnalysis });
  const saveActiveTab = async () => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab) return undefined;
    const result = await saveService.saveCurrentTab(tab);
    if (result.bookmarkId)
      void enqueueThumbnail({
        bookmarkId: result.bookmarkId,
        tabId: tab.id,
        windowId: tab.windowId
      });
    return result;
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
    const preferred = assignments.classify?.split('@')[0];
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
        additionalRules: promptRules || undefined
      },
      preferred
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
  browser.runtime.onMessage.addListener((message: unknown) => {
    const value = message as {
      type?: string;
      input?: AnalyzeTaskInput & { windowId?: number; folderId?: string };
    };
    if (value.type === 'queue-analysis' && value.input)
      return enqueueAnalysis(value.input);
    if (value.type === 'queue-thumbnail' && value.input)
      return enqueueThumbnail(value.input);
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
    } else if (info.menuItemId === contextMenuIds[0]) void saveActiveTab();
    else if (info.menuItemId === contextMenuIds[1] && info.linkUrl)
      void saveService.saveCurrentTab({
        title: info.linkUrl,
        url: info.linkUrl
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
