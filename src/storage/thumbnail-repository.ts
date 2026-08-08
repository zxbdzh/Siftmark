import type { SiftmarkDatabase } from './database';
import type { ThumbnailRecord } from './schema';

export interface ThumbnailRepository {
  get(bookmarkId: string): Promise<ThumbnailRecord | null>;
  findByHash(hash: string): Promise<ThumbnailRecord | null>;
  list(): Promise<ThumbnailRecord[]>;
  put(record: ThumbnailRecord): Promise<void>;
  delete(bookmarkId: string): Promise<void>;
}

export class DexieThumbnailRepository implements ThumbnailRepository {
  constructor(private readonly db: SiftmarkDatabase) {}
  get(bookmarkId: string): Promise<ThumbnailRecord | null> { return this.db.thumbnails.get(bookmarkId).then((value) => value ?? null); }
  findByHash(hash: string): Promise<ThumbnailRecord | null> { return this.db.thumbnails.where('hash').equals(hash).first().then((value) => value ?? null); }
  list(): Promise<ThumbnailRecord[]> { return this.db.thumbnails.toArray(); }
  put(record: ThumbnailRecord): Promise<void> { return this.db.thumbnails.put(record).then(() => undefined); }
  delete(bookmarkId: string): Promise<void> { return this.db.thumbnails.delete(bookmarkId); }
}
