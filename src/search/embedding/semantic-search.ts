import type { AiAdapter } from '../../ai/adapters/adapter';
import { sanitizeModelText } from '../../ai/security/model-input-sanitizer';
import type { ModelProfile } from '../../ai/types';
import { matchesSearchFilters } from '../local-search-index';
import type { SemanticSearchPort } from '../search-service';
import type { SearchDocument, SearchQuery, SearchResult } from '../types';
import { VectorSearch } from './vector-search';

export class EmbeddingSemanticSearch implements SemanticSearchPort {
  constructor(
    private readonly profile: ModelProfile,
    private readonly adapter: AiAdapter,
    private readonly vectors: VectorSearch,
    private readonly getDocuments: () => SearchDocument[]
  ) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (!this.adapter.embed) return [];
    const [queryVector] = await this.adapter.embed(
      this.profile,
      [sanitizeModelText(query.text)],
      new AbortController().signal
    );
    if (!queryVector?.length) return [];
    const documents = new Map(this.getDocuments().filter((document) => matchesSearchFilters(document, query.filters)).map((document) => [document.bookmarkId, document]));
    const matches = await this.vectors.query(queryVector, {
      profileId: `${this.profile.id}@${this.profile.version}`,
      vectorVersion: `${this.profile.model}@${this.profile.version}`,
      dimensions: queryVector.length
    }, query.limit ?? 100);
    return matches.flatMap((match) => {
      const document = documents.get(match.bookmarkId);
      return document ? [{ bookmarkId: document.bookmarkId, score: match.score, title: document.title, url: document.url, mode: 'semantic' as const }] : [];
    });
  }
}
