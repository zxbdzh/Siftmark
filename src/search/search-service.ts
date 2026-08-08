import { LocalSearchIndex } from './local-search-index';
import type { SearchQuery, SearchResult } from './types';
import { fuseSearchResults } from './fuse-results';

export interface SemanticSearchPort { search(query: SearchQuery): Promise<SearchResult[]> }
export class SearchService {
  constructor(private readonly local: LocalSearchIndex, private readonly semantic?: SemanticSearchPort) {}
  get semanticEnabled(): boolean { return Boolean(this.semantic); }
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const local = this.local.search(query);
    if (!this.semantic || !query.text.trim()) return local;
    try { const semantic = await this.semantic.search(query); return semantic.length > 0 ? fuseSearchResults(local, semantic, query.limit ?? 100) : local; }
    catch { return local; }
  }
}
