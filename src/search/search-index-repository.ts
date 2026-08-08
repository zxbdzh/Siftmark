import type { SiftmarkDatabase } from '../storage/database';
import type { SearchIndexRecord } from '../storage/schema';
import type { SearchDocument } from './types';
import { tokenize } from './tokenize';

export class SearchIndexRepository {
  constructor(private readonly db: SiftmarkDatabase) {}
  async listDocuments(): Promise<SearchDocument[]> {
    const rows = await this.db.searchIndex
      .where('kind')
      .equals('keyword')
      .toArray();
    return rows.flatMap((row) =>
      row.document ? [row.document as unknown as SearchDocument] : []
    );
  }
  async putDocuments(documents: SearchDocument[]): Promise<void> {
    const updatedAt = Date.now();
    const records = documents.map((document): SearchIndexRecord => {
      const combined = [
        document.title,
        document.url,
        document.folderPath,
        ...document.tags,
        document.summary,
        document.note
      ].join(' ');
      return {
        id: `keyword:${document.bookmarkId}`,
        kind: 'keyword',
        bookmarkId: document.bookmarkId,
        keywordTokens: tokenize(combined),
        document: document as unknown as Record<string, unknown>,
        updatedAt
      };
    });
    await this.db.searchIndex.bulkPut(records);
  }
  async deleteDocuments(bookmarkIds: string[]): Promise<void> {
    await this.db.searchIndex.bulkDelete(
      bookmarkIds.map((bookmarkId) => `keyword:${bookmarkId}`)
    );
  }
}
