import { Clock3, FolderTree, Settings, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChromeProfileRepository } from '../../src/ai/profiles/profile-repository';
import {
  ChromeSmartBookmarkHistoryRepository,
  type SmartBookmarkHistoryItem
} from '../../src/bookmarks/history-repository';
import { ChromeSettingsRepository } from '../../src/settings/settings-repository';

interface SmartBookmarkResponse {
  success: boolean;
  category?: string;
  error?: string;
}

export default function App() {
  const historyRepository = useMemo(
    () => new ChromeSmartBookmarkHistoryRepository(browser.storage.local),
    []
  );
  const profiles = useMemo(
    () => new ChromeProfileRepository(browser.storage.local),
    []
  );
  const settings = useMemo(
    () => new ChromeSettingsRepository(browser.storage.local),
    []
  );
  const [history, setHistory] = useState<SmartBookmarkHistoryItem[]>([]);
  const [modelLabel, setModelLabel] = useState('读取模型配置…');
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('智能收藏');
  const [tone, setTone] = useState<'normal' | 'success' | 'error'>('normal');

  const refresh = useCallback(async () => {
    const [items, storedProfiles, assignments] = await Promise.all([
      historyRepository.list(),
      profiles.list(),
      settings.getProfileAssignments()
    ]);
    setHistory(items.slice(0, 5));
    const profile = storedProfiles.find(
      (item) =>
        `${item.id}@${item.version}` === assignments.classify &&
        item.state === 'verified'
    );
    setConfigured(Boolean(profile));
    setModelLabel(profile ? `${profile.name} · ${profile.model}` : 'AI 模型未配置');
  }, [historyRepository, profiles, settings]);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const smartBookmark = async () => {
    if (!configured) {
      setTone('error');
      setStatus('请先配置 AI 模型');
      void browser.runtime.openOptionsPage();
      return;
    }
    setBusy(true);
    setTone('normal');
    setStatus('正在分析页面并选择文件夹…');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error('无法读取当前页面');
      const response = (await browser.runtime.sendMessage({
        type: 'smart-bookmark',
        input: { tabId: tab.id, url: tab.url, title: tab.title || tab.url }
      })) as SmartBookmarkResponse;
      if (!response.success) throw new Error(response.error || '智能收藏失败');
      setTone('success');
      setStatus(`已收藏到 ${response.category || '书签栏'}`);
      await refresh();
    } catch (error) {
      setTone('error');
      setStatus(error instanceof Error ? error.message : '智能收藏失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <strong className="brand-type"><Sparkles size={17}/>Siftmark</strong>
        <div>
          <button type="button" title="书签管理器" aria-label="打开书签管理器" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/manager.html') })}><FolderTree size={19}/></button>
          <button type="button" title="设置" aria-label="打开设置" onClick={() => void browser.runtime.openOptionsPage()}><Settings size={19}/></button>
        </div>
      </header>

      <section className="smart-action" data-tone={tone}>
        <button type="button" className="smart-star" disabled={busy} onClick={() => void smartBookmark()} aria-label="智能收藏当前页面"><Sparkles size={30}/></button>
        <strong>{status}</strong>
        <span>{modelLabel}</span>
      </section>

      <section className="recent-history">
        <header><h2><Clock3 size={15}/>最近记录</h2><button type="button" onClick={() => void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#history` })}>查看全部</button></header>
        {history.length ? <ul>{history.map((item) => <li key={item.id}><button type="button" onClick={() => void browser.tabs.create({ url: item.url })}><span>{item.title}</span><small>{item.category}</small></button></li>)}</ul> : <p>暂无智能收藏记录</p>}
      </section>
    </main>
  );
}
