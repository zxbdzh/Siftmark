import type { SearchDocument, SearchQuery, SearchResult } from './types';
import { editDistanceAtMostOne, normalizeSearchText, tokenize } from './tokenize';

const FIELD_WEIGHTS = { title: 12, domain: 8, tags: 10, folderPath: 5, url: 4, summary: 3, note: 2 } as const;
type WeightedField = keyof typeof FIELD_WEIGHTS;
interface IndexedDocument { document: SearchDocument; fields: Record<WeightedField, string>; tokens: Record<WeightedField, string[]> }

export class LocalSearchIndex {
  private readonly rows = new Map<string, IndexedDocument>();

  upsert(document: SearchDocument): void {
    const fields = { title: document.title, domain: domainOf(document.url), tags: document.tags.join(' '), folderPath: document.folderPath, url: document.url, summary: document.summary, note: document.note };
    this.rows.set(document.bookmarkId, { document, fields, tokens: Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, tokenize(value)])) as Record<WeightedField, string[]> });
  }
  remove(bookmarkId: string): void { this.rows.delete(bookmarkId); }
  clear(): void { this.rows.clear(); }
  async rebuild(documents: SearchDocument[], chunkSize = 200, onProgress?: (completed: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    this.clear();
    for (let index = 0; index < documents.length; index += chunkSize) {
      if (signal?.aborted) return;
      documents.slice(index, index + chunkSize).forEach((document) => this.upsert(document));
      onProgress?.(Math.min(index + chunkSize, documents.length), documents.length);
      await Promise.resolve();
    }
  }
  search(query: SearchQuery): SearchResult[] {
    const queryText = normalizeSearchText(query.text);
    const queryTokens = tokenize(query.text);
    const results: SearchResult[] = [];
    for (const row of this.rows.values()) {
      if (!matchesSearchFilters(row.document, query.filters)) continue;
      let score = queryText ? scoreRow(row, queryText, queryTokens) : 1;
      if (queryText && score <= 0) continue;
      if (normalizeSearchText(row.document.title) === queryText) score += 100;
      results.push({ bookmarkId: row.document.bookmarkId, score, title: row.document.title, url: row.document.url, mode: 'local' });
    }
    return results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-CN') || left.bookmarkId.localeCompare(right.bookmarkId)).slice(0, query.limit ?? 100);
  }
}

function scoreRow(row: IndexedDocument, queryText: string, queryTokens: string[]): number {
  let score = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS) as Array<[WeightedField, number]>) {
    const normalized = normalizeSearchText(row.fields[field]);
    if (normalized.includes(queryText)) score += weight * 2;
    if (normalized.startsWith(queryText)) score += weight;
    for (const queryToken of queryTokens) {
      if (row.tokens[field].includes(queryToken)) score += weight;
      else if (row.tokens[field].some((token) => token.startsWith(queryToken))) score += weight * 0.6;
      else if (queryToken.length >= 4 && row.tokens[field].some((token) => editDistanceAtMostOne(token, queryToken))) score += weight * 0.3;
    }
  }
  return score;
}

export function matchesSearchFilters(document: SearchDocument, filters: SearchQuery['filters']): boolean {
  if (filters.folderId && document.folderId !== filters.folderId) return false;
  if (filters.domain && domainOf(document.url) !== filters.domain.toLocaleLowerCase()) return false;
  if (filters.tag && !document.tags.includes(filters.tag)) return false;
  if (filters.status && document.health !== filters.status) return false;
  if (filters.createdAfter && document.createdAt < filters.createdAfter) return false;
  if (filters.createdBefore && document.createdAt > filters.createdBefore) return false;
  return true;
}
function domainOf(url: string): string { try { return new URL(url).hostname.toLocaleLowerCase(); } catch { return ''; } }
