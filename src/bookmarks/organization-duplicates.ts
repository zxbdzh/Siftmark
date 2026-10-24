import { isBookmark, type BookmarkNode } from './types';

export interface OrganizationDuplicateGroup {
  id: string;
  url: string;
  keepBookmarkId: string;
  bookmarks: Array<BookmarkNode & { url: string }>;
}

export function groupOrganizationDuplicates(bookmarks: BookmarkNode[]) {
  const buckets = new Map<string, Array<BookmarkNode & { url: string }>>();
  for (const bookmark of bookmarks) {
    if (!isBookmark(bookmark)) continue;
    const bucket = buckets.get(bookmark.url) ?? [];
    bucket.push(bookmark);
    buckets.set(bookmark.url, bucket);
  }
  const groups: OrganizationDuplicateGroup[] = [];
  const representatives: Array<BookmarkNode & { url: string }> = [];
  for (const [url, bucket] of buckets) {
    // 只按原始 URL 相等分组；参数、锚点和大小写差异均不自动合并。
    const ordered = [...bucket].sort(
      (a, b) =>
        (a.dateAdded ?? Number.MAX_SAFE_INTEGER) -
          (b.dateAdded ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
    );
    representatives.push(ordered[0]!);
    if (ordered.length > 1)
      groups.push({
        id: ordered[0]!.id,
        url,
        keepBookmarkId: ordered[0]!.id,
        bookmarks: ordered
      });
  }
  return { groups, representatives };
}
