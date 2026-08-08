import type { SiftmarkDatabase } from '../storage/database';
import type { SearchIndexRecord } from '../storage/schema';
import type { SearchDocument } from './types';
import { tokenize } from './tokenize';

export class SearchIndexRepository {
  constructor(private readonly db: SiftmarkDatabase) {}
  async listDocuments(): Promise<SearchDocument[]> {
    const rows = await this.db.searchIndex.where('kind').equals('keyword').toArray();
    return rows.flatMap((row) => row.document ? [row.document as unknown as SearchDocument] : []);
  }
  async putDocument(document: SearchDocument): Promise<void> {
    const combined = [document.title, document.url, document.folderPath, ...document.tags, document.summary, document.note].join(' ');
    const record: SearchIndexRecord = { id: `keyword:${document.bookmarkId}`, kind: 'keyword', bookmarkId: document.bookmarkId, keywordTokens: tokenize(combined), document: document as unknown as Record<string, unknown>, updatedAt: Date.now() };
    await this.db.searchIndex.put(record);
  }
  deleteDocument(bookmarkId: string): Promise<void> { return this.db.searchIndex.delete(`keyword:${bookmarkId}`); }
}
