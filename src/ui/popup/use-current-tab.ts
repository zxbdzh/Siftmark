import { useEffect, useState } from 'react';
import type { BrowserTab } from '../../bookmarks/save-service';
export function useCurrentTab() { const [tab, setTab] = useState<BrowserTab>(); useEffect(() => { void browser.tabs.query({ active: true, currentWindow: true }).then(([current]) => setTab(current)); }, []); return tab; }
