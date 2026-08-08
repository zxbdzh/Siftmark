import { useMemo } from 'react';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import { SaveService } from '../../src/bookmarks/save-service';
import { QuickSave } from '../../src/ui/popup/QuickSave';
import { useCurrentTab } from '../../src/ui/popup/use-current-tab';

export default function App() {
  const tab = useCurrentTab();
  const service = useMemo(() => new SaveService(new ChromeBookmarkRepository(browser.bookmarks as unknown as ChromeBookmarkApi), { enqueue: (input) => browser.runtime.sendMessage({ type: 'queue-analysis', input }) }), []);
  return <main><header><strong className="brand-type">Siftmark</strong><button type="button" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/manager.html') })}>打开管理器</button></header><QuickSave service={service} tab={tab}/></main>;
}
