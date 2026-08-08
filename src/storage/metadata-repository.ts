import type { SiftmarkDatabase } from './database';
import type { MetadataRepository } from './types';
import type { BookmarkMetadata } from './types';

export class DexieMetadataRepository implements MetadataRepository {
  constructor(private readonly db: SiftmarkDatabase) {}

  get(bookmarkId: string): Promise<BookmarkMetadata | null> {
    return this.db.bookmarkMetadata
      .get(bookmarkId)
      .then((value) => value ?? null);
  }

  list(): Promise<BookmarkMetadata[]> {
    return this.db.bookmarkMetadata.toArray();
  }

  async put(metadata: BookmarkMetadata): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.bookmarkMetadata,
      this.db.softDeletedMetadata,
      async () => {
        await this.db.bookmarkMetadata.put(metadata);
        await this.db.softDeletedMetadata.delete(metadata.bookmarkId);
      }
    );
  }

  async softDelete(bookmarkId: string, deletedAt: number): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.bookmarkMetadata,
      this.db.softDeletedMetadata,
      async () => {
        const metadata = await this.db.bookmarkMetadata.get(bookmarkId);
        if (!metadata) return;
        await this.db.softDeletedMetadata.put({
          bookmarkId,
          payload: metadata,
          deletedAt
        });
        await this.db.bookmarkMetadata.delete(bookmarkId);
      }
    );
  }

  async restore(bookmarkId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.bookmarkMetadata,
      this.db.softDeletedMetadata,
      async () => {
        const deleted = await this.db.softDeletedMetadata.get(bookmarkId);
        if (!deleted) return;
        await this.db.bookmarkMetadata.put(deleted.payload);
        await this.db.softDeletedMetadata.delete(bookmarkId);
      }
    );
  }

  async purgeDeletedBefore(timestamp: number): Promise<number> {
    return this.db.transaction('rw', this.db.softDeletedMetadata, async () => {
      const rows = await this.db.softDeletedMetadata
        .where('deletedAt')
        .below(timestamp)
        .toArray();
      if (rows.length > 0)
        await this.db.softDeletedMetadata.bulkDelete(
          rows.map((row) => row.bookmarkId)
        );
      return rows.length;
    });
  }
}
