import { openSiftmarkDatabase } from '../src/storage/database';
import { DexieTaskRepository } from '../src/tasks/task-repository';
import { recoverInterruptedTasks } from '../src/tasks/task-recovery';
import { TaskRunner } from '../src/tasks/task-runner';
import { logger } from '../src/utils/logger';
import { ChromeBookmarkRepository } from '../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../src/platform/chrome/chrome-types';
import { SaveService } from '../src/bookmarks/save-service';
import { registerBrowserCommands } from '../src/platform/chrome/commands';
import { contextMenuIds, registerContextMenus } from '../src/platform/chrome/context-menus';

const TASK_WAKE_ALARM = 'siftmark-task-wake';

export default defineBackground(() => {
  const database = openSiftmarkDatabase();
  const tasks = new DexieTaskRepository(database);
  const runner = new TaskRunner(tasks);
  const bookmarks = new ChromeBookmarkRepository(browser.bookmarks as unknown as ChromeBookmarkApi);
  const saveService = new SaveService(bookmarks, { enqueue: async (input) => { const now = Date.now(); await tasks.put({ id: crypto.randomUUID(), type: 'analyze-bookmark', state: 'queued', input, completed: 0, failed: 0, retryCount: 0, idempotencyKey: crypto.randomUUID(), createdAt: now, updatedAt: now }); } });
  const saveActiveTab = async () => { const [tab] = await browser.tabs.query({active:true,currentWindow:true}); if(tab) await saveService.saveCurrentTab(tab); };

  const processTasks = async () => {
    await recoverInterruptedTasks(tasks, Date.now());
    await runner.runNext();
  };

  void processTasks();
  browser.runtime.onInstalled.addListener(() => {
    logger.info('扩展已安装');
    void browser.alarms.create(TASK_WAKE_ALARM, { periodInMinutes: 1 });
    void registerContextMenus(browser.contextMenus);
  });
  registerBrowserCommands(browser.commands, () => void saveActiveTab());
  browser.runtime.onMessage.addListener((message: unknown) => { const value=message as {type?:string;input?:{bookmarkId:string;tabId?:number}}; if(value.type==='queue-analysis'&&value.input)return tasks.put({id:crypto.randomUUID(),type:'analyze-bookmark',state:'queued',input:value.input,completed:0,failed:0,retryCount:0,idempotencyKey:crypto.randomUUID(),createdAt:Date.now(),updatedAt:Date.now()}); if(value.type==='save-current-page')return saveActiveTab(); });
  browser.contextMenus.onClicked.addListener((info) => { if(info.menuItemId===contextMenuIds[3])void browser.tabs.create({url:browser.runtime.getURL('/manager.html')}); else if(info.menuItemId===contextMenuIds[2]&&info.selectionText)void browser.storage.local.set({[`siftmark.note.${crypto.randomUUID()}`]:info.selectionText.slice(0,2000)}); else if(info.menuItemId===contextMenuIds[0])void saveActiveTab(); });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TASK_WAKE_ALARM) void runner.runNext();
  });
});
