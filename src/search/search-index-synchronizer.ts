import { LocalSearchIndex } from './local-search-index';
import type { SearchDocument } from './types';

export interface SearchDocumentRepository {
  listDocuments(): Promise<SearchDocument[]>;
  putDocument(document: SearchDocument): Promise<void>;
  deleteDocument(bookmarkId: string): Promise<void>;
}

export class SearchIndexSynchronizer {
  private initialized = false;
  private signatures = new Map<string, string>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly index: LocalSearchIndex,
    private readonly repository: SearchDocumentRepository
  ) {}

  sync(documents: SearchDocument[]): Promise<void> {
    const snapshot = documents.map((document) => ({ ...document, tags: [...document.tags] }));
    this.pending = this.pending.then(() => this.performSync(snapshot));
    return this.pending;
  }

  private async performSync(documents: SearchDocument[]): Promise<void> {
    if (!this.initialized) {
      const persisted = await this.repository.listDocuments();
      await this.index.rebuild(persisted);
      this.signatures = new Map(persisted.map((document) => [document.bookmarkId, signatureOf(document)]));
      this.initialized = true;
    }

    const next = new Map(documents.map((document) => [document.bookmarkId, document]));
    const changed = documents.filter((document) => this.signatures.get(document.bookmarkId) !== signatureOf(document));
    const removed = [...this.signatures.keys()].filter((bookmarkId) => !next.has(bookmarkId));

    changed.forEach((document) => this.index.upsert(document));
    removed.forEach((bookmarkId) => this.index.remove(bookmarkId));
    await Promise.all([
      ...changed.map((document) => this.repository.putDocument(document)),
      ...removed.map((bookmarkId) => this.repository.deleteDocument(bookmarkId))
    ]);

    this.signatures = new Map(documents.map((document) => [document.bookmarkId, signatureOf(document)]));
  }
}

function signatureOf(document: SearchDocument): string {
  return JSON.stringify(document);
}
