import type { SearchResult } from './types';

export function fuseSearchResults(local: SearchResult[], semantic: SearchResult[], limit = 100): SearchResult[] {
  const fused = new Map<string, SearchResult>();
  const localMax = Math.max(0, ...local.map((row) => row.score));
  const semanticMax = Math.max(0, ...semantic.map((row) => row.score));
  for (const row of local) fused.set(row.bookmarkId, { ...row, score: localMax > 0 ? (row.score / localMax) * 0.65 : 0, mode: 'fused' });
  for (const row of semantic) {
    const current = fused.get(row.bookmarkId);
    fused.set(row.bookmarkId, { ...row, score: (current?.score ?? 0) + (semanticMax > 0 ? (row.score / semanticMax) * 0.35 : 0), mode: 'fused' });
  }
  return [...fused.values()].sort((left, right) => right.score - left.score || left.bookmarkId.localeCompare(right.bookmarkId)).slice(0, limit);
}
