import type {
  OrganizationBookmarkInput,
  OrganizationSimilarity
} from '../ai/organization-types';
import { organizationSimilaritySchema } from '../ai/schemas/organization-parser';

export function similarityKey(ids: readonly string[]): string {
  return JSON.stringify([...ids].sort());
}

export function validateSimilarities(
  value: unknown,
  bookmarks: OrganizationBookmarkInput[],
  candidates?: Array<[string, string]>,
  reportIgnored?: (count: number) => void
): OrganizationSimilarity[] {
  const parsed = organizationSimilaritySchema.array().max(80).parse(value);
  const known = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const allowed = candidates && new Set(candidates.map(similarityKey));
  const seen = new Set<string>();
  const accepted: OrganizationSimilarity[] = [];
  for (const pair of parsed) {
    const key = similarityKey(pair.bookmarkIds);
    // 相似项只提供人工建议；越界配对不入库，不能阻断已校验的分类或触发回收。
    if (
      pair.bookmarkIds.some((id) => !known.has(id)) ||
      (allowed && !allowed.has(key)) ||
      seen.has(key) ||
      known.get(pair.bookmarkIds[0])!.url ===
        known.get(pair.bookmarkIds[1])!.url
    )
      continue;
    seen.add(key);
    accepted.push(pair);
  }
  reportIgnored?.(parsed.length - accepted.length);
  return accepted;
}

// 候选只用于再次询问模型，不意味着相似，更不会据此回收书签。
export function similarityCandidates(
  bookmarks: OrganizationBookmarkInput[]
): Array<[string, string]> {
  const normalized = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  const rows = bookmarks.map((bookmark) => ({
    bookmark,
    title: normalized(bookmark.title),
    resource: resource(bookmark.url)
  }));
  const pairs = new Map<string, [string, string]>();
  const add = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    if (a.bookmark.url === b.bookmark.url) return;
    const ids: [string, string] = [a.bookmark.id, b.bookmark.id];
    pairs.set(similarityKey(ids), ids);
  };
  const resources = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = resources.get(row.resource) ?? [];
    // 同一路径不同参数仅作为候选；参数可能决定完全不同的页面，仍由模型与用户复核。
    if (row.resource) for (const other of group.slice(-3)) add(other, row);
    group.push(row);
    resources.set(row.resource, group);
  }
  const titles = [...rows].sort((a, b) => a.title.localeCompare(b.title));
  for (let index = 0; index < titles.length; index += 1) {
    const row = titles[index]!;
    if (row.title.length < 6) continue;
    // 相邻窗口控制大库比较量；分类模型也会补充本批中语义相似而字面不同的建议。
    for (const other of titles.slice(index + 1, index + 5)) {
      if (
        (row.title.match(/\d+/g) ?? []).join() !==
        (other.title.match(/\d+/g) ?? []).join()
      )
        continue;
      const grams = (text: string) =>
        new Set(
          Array.from({ length: Math.max(0, text.length - 1) }, (_, i) =>
            text.slice(i, i + 2)
          )
        );
      const a = grams(row.title),
        b = grams(other.title);
      const shared = [...a].filter((gram) => b.has(gram)).length;
      if ((2 * shared) / (a.size + b.size) >= 0.85) add(row, other);
    }
  }
  return [...pairs.values()];
}

function resource(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

export function similarityReviewBatches(
  pairs: Array<[string, string]>,
  bookmarks: OrganizationBookmarkInput[]
) {
  const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const result: Array<{
    pairs: Array<[string, string]>;
    bookmarks: OrganizationBookmarkInput[];
  }> = [];
  // 每批最多十对，限制脱敏网址与标题的上下文体积，同时允许跨原始分析批次比较。
  for (let index = 0; index < pairs.length; index += 10) {
    const batch = pairs.slice(index, index + 10);
    result.push({
      pairs: batch,
      bookmarks: [...new Set(batch.flat())].map((id) => byId.get(id)!)
    });
  }
  return result;
}
