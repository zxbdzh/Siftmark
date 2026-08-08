import { ScanSearch } from 'lucide-react';
import { useState } from 'react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import { isBookmark } from '../../bookmarks/types';
import { normalizeUrlConservatively } from '../../health/url-normalization';
import type { MetadataRepository } from '../../storage/types';

interface ScanResult {
  folders: number;
  bookmarks: number;
  duplicateGroups: number;
  duplicateBookmarks: number;
  checked: number;
  unchecked: number;
  needsTriage: number;
}

export function ScanStep({
  bookmarks,
  metadata
}: {
  bookmarks: BookmarkRepository;
  metadata?: MetadataRepository;
}) {
  const [result, setResult] = useState<ScanResult>();
  const [busy, setBusy] = useState(false);
  const scan = async () => {
    setBusy(true);
    try {
      const [nodes, metadataRows] = await Promise.all([
        bookmarks.getTree(),
        metadata?.list() ?? Promise.resolve([])
      ]);
      const bookmarkRows = nodes.filter(isBookmark);
      const metadataByBookmark = new Map(
        metadataRows.map((row) => [row.bookmarkId, row])
      );
      const duplicateBuckets = new Map<string, number>();
      for (const bookmark of bookmarkRows) {
        const normalized = normalizeUrlConservatively(bookmark.url);
        duplicateBuckets.set(
          normalized,
          (duplicateBuckets.get(normalized) ?? 0) + 1
        );
      }
      const duplicateCounts = [...duplicateBuckets.values()].filter(
        (count) => count > 1
      );
      let checked = 0;
      let needsTriage = 0;
      for (const bookmark of bookmarkRows) {
        const row = metadataByBookmark.get(bookmark.id);
        if (row && row.health !== 'unchecked') checked += 1;
        if (!row || row.confidence === 'low' || row.confidence === 'unknown') {
          needsTriage += 1;
        }
      }
      setResult({
        folders: nodes.filter((node) => !isBookmark(node) && node.id !== '0')
          .length,
        bookmarks: bookmarkRows.length,
        duplicateGroups: duplicateCounts.length,
        duplicateBookmarks: duplicateCounts.reduce(
          (total, count) => total + count,
          0
        ),
        checked,
        unchecked: bookmarkRows.length - checked,
        needsTriage
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="onboarding-choice">
      <p>扫描仅统计现有原生书签，不移动、重命名或删除任何项目。</p>
      <button type="button" disabled={busy} onClick={() => void scan()}>
        <ScanSearch size={16} />
        {busy ? '正在扫描' : '扫描现有书签'}
      </button>
      {result ? (
        <output className="onboarding-scan-result">
          <strong>
            {result.folders} 个文件夹，{result.bookmarks} 个书签
          </strong>
          <span>
            {result.duplicateGroups} 组重复网址，涉及{' '}
            {result.duplicateBookmarks} 个书签
          </span>
          <span>
            {result.checked} 个已检查，{result.unchecked} 个未检查
          </span>
          <span>{result.needsTriage} 个书签待整理</span>
        </output>
      ) : null}
    </div>
  );
}
