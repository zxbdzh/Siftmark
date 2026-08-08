import { AnalysisCoordinator } from '../src/ai/analysis-coordinator';
import { createDefaultAiAdapterRegistry } from '../src/ai/create-adapter-registry';
import { DexieProposalRepository } from '../src/ai/proposal';
import { ChromeProfileRepository } from '../src/ai/profiles/profile-repository';
import { SaveService } from '../src/bookmarks/save-service';
import { ChromeBookmarkRepository } from '../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../src/platform/chrome/chrome-types';
import { registerBrowserCommands } from '../src/platform/chrome/commands';
import { contextMenuIds, registerContextMenus } from '../src/platform/chrome/context-menus';
import { RuleEngine } from '../src/rules/rule-engine';
import { ChromeSettingsRepository } from '../src/settings/settings-repository';
import { openSiftmarkDatabase } from '../src/storage/database';
import { DexieTaskRepository } from '../src/tasks/task-repository';
import { recoverInterruptedTasks } from '../src/tasks/task-recovery';
import { TaskRunner } from '../src/tasks/task-runner';
import type { TaskHandler } from '../src/tasks/types';
import { logger } from '../src/utils/logger';
import { ChromeNoteDraftRepository } from '../src/notes/draft-repository';

const TASK_WAKE_ALARM = 'siftmark-task-wake';

interface AnalyzeTaskInput { bookmarkId: string; tabId?: number; taskId?: string }

export default defineBackground(() => {
  const database = openSiftmarkDatabase();
  const tasks = new DexieTaskRepository(database);
  const runner = new TaskRunner(tasks);
  const bookmarks = new ChromeBookmarkRepository(browser.bookmarks as unknown as ChromeBookmarkApi);
  const profiles = new ChromeProfileRepository(browser.storage.local);
  const settings = new ChromeSettingsRepository(browser.storage.local);
  const proposals = new DexieProposalRepository(database);
  const adapters = createDefaultAiAdapterRegistry();
  const noteDrafts = new ChromeNoteDraftRepository(browser.storage.local);

  const enqueueAnalysis = async (input: AnalyzeTaskInput & { taskId?: string }) => {
    const now = Date.now();
    const taskId = input.taskId ?? crypto.randomUUID();
    await tasks.put({ id: taskId, type: 'analyze-bookmark', state: 'queued', input: { bookmarkId: input.bookmarkId, tabId: input.tabId }, completed: 0, failed: 0, retryCount: 0, idempotencyKey: crypto.randomUUID(), createdAt: now, updatedAt: now });
    void runner.runNext();
    return { taskId };
  };
  const saveService = new SaveService(bookmarks, { enqueue: enqueueAnalysis });
  const saveActiveTab = async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return tab ? saveService.saveCurrentTab(tab) : undefined; };

  const analyzeHandler: TaskHandler<AnalyzeTaskInput> = async ({ task, signal, reportProgress }) => {
    const snapshot = await bookmarks.get(task.input.bookmarkId);
    if (!snapshot?.url) return { state: 'failed', failed: task.failed + 1 };
    await reportProgress({ completed: 0, failed: 0 });
    if (signal.aborted) return { state: 'cancelled' };
    const [availableProfiles, rules, promptRules, assignments] = await Promise.all([profiles.list(), settings.getRules(), settings.getPromptRules(), settings.getProfileAssignments()]);
    const preferred = assignments.classify?.split('@')[0];
    const coordinator = new AnalysisCoordinator({ bookmarks, profiles: availableProfiles, adapters, proposals, rules: new RuleEngine(rules) });
    await coordinator.analyze(snapshot, { title: snapshot.title, url: snapshot.url, currentFolderPath: [snapshot.parentId], additionalRules: promptRules || undefined }, preferred);
    await reportProgress({ completed: 1, failed: 0 });
    return { state: 'succeeded', completed: 1 };
  };
  runner.register('analyze-bookmark', analyzeHandler);

  const processTasks = async () => { await recoverInterruptedTasks(tasks, Date.now()); await runner.runNext(); };
  void processTasks();
  browser.runtime.onInstalled.addListener(() => {
    logger.info('扩展已安装');
    void browser.alarms.create(TASK_WAKE_ALARM, { periodInMinutes: 1 });
    void registerContextMenus(browser.contextMenus);
  });
  registerBrowserCommands(browser.commands, () => void saveActiveTab());
  browser.runtime.onMessage.addListener((message: unknown) => {
    const value = message as { type?: string; input?: AnalyzeTaskInput };
    if (value.type === 'queue-analysis' && value.input) return enqueueAnalysis(value.input);
    if (value.type === 'save-current-page') return saveActiveTab();
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === contextMenuIds[3]) void browser.tabs.create({ url: browser.runtime.getURL('/manager.html') });
    else if (info.menuItemId === contextMenuIds[2] && info.selectionText) {
      const text = info.selectionText.slice(0, 2_000);
      const id = crypto.randomUUID();
      void noteDrafts.put({ id, text, title: tab?.title ?? '', url: tab?.url ?? '', createdAt: Date.now(), truncated: info.selectionText.length > text.length });
    } else if (info.menuItemId === contextMenuIds[0]) void saveActiveTab();
    else if (info.menuItemId === contextMenuIds[1] && info.linkUrl) void saveService.saveCurrentTab({ title: info.linkUrl, url: info.linkUrl });
  });
  browser.alarms.onAlarm.addListener((alarm) => { if (alarm.name === TASK_WAKE_ALARM) void runner.runNext(); });
});
