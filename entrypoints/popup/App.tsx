import { useEffect, useMemo, useState } from 'react';
import { SaveService, type BrowserTab, type SaveResult } from '../../src/bookmarks/save-service';
import { isBookmark, type BookmarkNode } from '../../src/bookmarks/types';
import { DexieOperationRepository } from '../../src/operations/operation-repository';
import { UndoService } from '../../src/operations/undo-service';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import { ChromeSettingsRepository } from '../../src/settings/settings-repository';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { DexieTaskRepository } from '../../src/tasks/task-repository';
import { QuickSave } from '../../src/ui/popup/QuickSave';
import { TabBatchSave } from '../../src/ui/popup/TabBatchSave';
import { TaskProgress } from '../../src/ui/popup/TaskProgress';
import { useCurrentTab } from '../../src/ui/popup/use-current-tab';
import { hydrateTheme } from '../../src/ui/theme/theme-store';
import { DexieProposalRepository } from '../../src/ai/proposal';
import { RuleEngine } from '../../src/rules/rule-engine';

export default function App() {
  const tab = useCurrentTab();
  const repository = useMemo(() => new ChromeBookmarkRepository(browser.bookmarks as unknown as ChromeBookmarkApi), []);
  const database = useMemo(() => openSiftmarkDatabase(), []);
  const operations = useMemo(() => new DexieOperationRepository(database), [database]);
  const tasks = useMemo(() => new DexieTaskRepository(database), [database]);
  const proposals = useMemo(() => new DexieProposalRepository(database), [database]);
  const settings = useMemo(() => new ChromeSettingsRepository(browser.storage.local), []);
  const service = useMemo(() => new SaveService(repository, { enqueue: (input) => browser.runtime.sendMessage({ type: 'queue-analysis', input }) }, operations), [operations, repository]);
  const undo = useMemo(() => new UndoService(repository, operations), [operations, repository]);
  const [folders, setFolders] = useState<BookmarkNode[]>([]);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [folderId, setFolderId] = useState<string>();
  const [recentOperationId, setRecentOperationId] = useState<string>();
  const [taskId, setTaskId] = useState<string>();
  const [taskBookmarkId, setTaskBookmarkId] = useState<string>();
  const [destinationHint, setDestinationHint] = useState('');
  const [queueAnalysis, setQueueAnalysis] = useState(true);

  useEffect(() => {
    void hydrateTheme(settings);
    void Promise.all([repository.getTree(), settings.getRecentFolder(), operations.listRecent(20), browser.tabs.query({ currentWindow: true }), settings.getRules(), settings.getSpecialFolders()]).then(([nodes, recentFolder, recentOperations, windowTabs, rules, specialFolders]) => {
      const available = nodes.filter((node) => !isBookmark(node));
      setFolders(available);
      const fallback = available.some((folder) => folder.id === recentFolder) ? recentFolder : available.findLast((folder) => folder.parentId === '0')?.id ?? available[0]?.id;
      const evaluation = tab?.url ? new RuleEngine(rules).evaluate({ url: tab.url, title: tab.title ?? '' }) : undefined;
      const terminal = evaluation?.terminalAction;
      const ruleFolderId = terminal?.type === 'move' ? terminal.folderId : terminal?.type === 'send-to-inbox' ? specialFolders.inboxId : undefined;
      if (ruleFolderId && available.some((folder) => folder.id === ruleFolderId)) { setFolderId(ruleFolderId); setDestinationHint('已按本地规则选择目标文件夹'); }
      else { setFolderId(fallback); setDestinationHint(recentFolder === fallback ? '使用最近选择的文件夹' : '可手动选择目标文件夹，AI 建议将在保存后进入审核'); }
      setQueueAnalysis(terminal?.type !== 'skip-ai');
      const recentCreate = recentOperations.find((operation) => operation.type === 'create' && !operation.undoneAt && (!tab?.url || operation.after.url === tab.url));
      setRecentOperationId(recentCreate?.id);
      setTabs(windowTabs);
    });
  }, [operations, repository, settings, tab?.title, tab?.url]);

  const handleSaved = (result: SaveResult, destination: string) => {
    setFolderId(destination);
    setTaskId(result.taskId);
    setTaskBookmarkId(result.bookmarkId);
    setRecentOperationId(result.operationId);
    void settings.setRecentFolder(destination);
    if (result.bookmarkId && tab?.id !== undefined) void browser.runtime.sendMessage({ type: 'queue-thumbnail', input: { bookmarkId: result.bookmarkId, tabId: tab.id } });
  };

  return <main><header><strong className="brand-type">Siftmark</strong><button type="button" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/manager.html') })}>打开管理器</button></header><QuickSave service={service} tab={tab} folders={folders} defaultFolderId={folderId} destinationHint={destinationHint} queueAnalysis={queueAnalysis} recentOperationId={recentOperationId} onSaved={handleSaved} onUndo={async (operationId) => { const result = await undo.undo(operationId); if (!result.ok) throw new Error('无法撤销最近保存'); setRecentOperationId(undefined); }}/><TaskProgress repository={tasks} taskId={taskId} bookmarkId={taskBookmarkId} proposals={proposals}/><TabBatchSave service={service} tabs={tabs} folderId={folderId}/></main>;
}
