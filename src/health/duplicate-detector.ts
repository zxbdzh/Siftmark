import type { BookmarkNode } from '../bookmarks/types';
import { normalizeUrlConservatively } from './url-normalization';

export interface DuplicateGroup {
  normalizedUrl: string;
  keepBookmarkId: string;
  bookmarkIds: string[];
  kind: 'exact';
}

export interface SimilaritySuggestion {
  bookmarkIds: [string, string];
  evidence: Array<'domain' | 'title'>;
  kind: 'similar';
}

export interface DuplicateDetectionResult {
  exact: DuplicateGroup[];
  similar: SimilaritySuggestion[];
}

export function detectDuplicates(bookmarks: Array<BookmarkNode & { url: string }>): DuplicateDetectionResult {
  const exactBuckets = new Map<string, Array<BookmarkNode & { url: string }>>();
  for (const bookmark of bookmarks) {
    const normalized = normalizeUrlConservatively(bookmark.url);
    const rows = exactBuckets.get(normalized) ?? [];
    rows.push(bookmark);
    exactBuckets.set(normalized, rows);
  }
  const exact = [...exactBuckets.entries()].filter(([, rows]) => rows.length > 1).map(([normalizedUrl, rows]) => {
    const ordered = [...rows].sort((left, right) => (left.dateAdded ?? Number.MAX_SAFE_INTEGER) - (right.dateAdded ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
    return { normalizedUrl, keepBookmarkId: ordered[0]!.id, bookmarkIds: ordered.map((row) => row.id), kind: 'exact' as const };
  });
  const exactPairs = new Set(exact.flatMap((group) => pairsOf(group.bookmarkIds).map(pairKey)));
  const similar: SimilaritySuggestion[] = [];
  for (let leftIndex = 0; leftIndex < bookmarks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bookmarks.length; rightIndex += 1) {
      const left = bookmarks[leftIndex]!;
      const right = bookmarks[rightIndex]!;
      if (exactPairs.has(pairKey([left.id, right.id]))) continue;
      const sameDomain = domainOf(left.url) !== '' && domainOf(left.url) === domainOf(right.url);
      const similarTitle = normalizedTitle(left.title).length >= 4 && titleSimilarity(normalizedTitle(left.title), normalizedTitle(right.title)) >= 0.7;
      if (sameDomain && similarTitle) similar.push({ bookmarkIds: [left.id, right.id], evidence: ['domain', 'title'], kind: 'similar' });
    }
  }
  return { exact, similar };
}

function pairsOf(ids: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < ids.length; left += 1) for (let right = left + 1; right < ids.length; right += 1) pairs.push([ids[left]!, ids[right]!]);
  return pairs;
}

function pairKey(ids: [string, string]): string { return [...ids].sort().join('\u0000'); }
function domainOf(value: string): string { try { return new URL(value).hostname.toLocaleLowerCase(); } catch { return ''; } }
function normalizedTitle(value: string): string { return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function titleSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftTokens = bigrams(left);
  const rightTokens = bigrams(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return (2 * intersection) / Math.max(1, leftTokens.size + rightTokens.size);
}
function bigrams(value: string): Set<string> { const result = new Set<string>(); for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2)); return result; }
