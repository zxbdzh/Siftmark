import { useEffect, useMemo, useState } from 'react';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import type { BookmarkNode } from '../../src/bookmarks/types';
import { ManagerLayout } from '../../src/ui/manager/ManagerLayout';

export default function App() {
  const repository = useMemo(() => new ChromeBookmarkRepository(browser.bookmarks as unknown as ChromeBookmarkApi), []);
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void repository.getTree().then(setNodes).finally(() => setLoading(false)); }, [repository]);
  return <ManagerLayout nodes={nodes} loading={loading} repository={repository} />;
}
