import type { SiftmarkDatabase } from '../../storage/database';
import type { SearchIndexRecord } from '../../storage/schema';
import type { EmbeddingKey, EmbeddingVector, EmbeddingVersion } from './types';

export class EmbeddingRepository {
  constructor(private readonly db: SiftmarkDatabase) {}

  async put(vector: EmbeddingVector): Promise<void> {
    const record: SearchIndexRecord = {
      id: idFor(vector.bookmarkId, vector.key),
      kind: 'embedding',
      bookmarkId: vector.bookmarkId,
      keywordTokens: [],
      embeddingProfile: vector.key.profileId,
      dimensions: vector.key.dimensions,
      vectorVersion: vector.key.vectorVersion,
      vector: vector.values,
      document: { inputHash: vector.inputHash },
      stale: vector.stale,
      updatedAt: vector.updatedAt
    };
    await this.db.searchIndex.put(record);
  }

  async listByKey(key: EmbeddingKey): Promise<EmbeddingVector[]> {
    const rows = await this.db.searchIndex
      .where('[embeddingProfile+vectorVersion+dimensions]')
      .equals([key.profileId, key.vectorVersion, key.dimensions])
      .toArray();
    return rows.flatMap(toVector).filter((vector) => !vector.stale);
  }

  async findCurrent(bookmarkId: string, version: EmbeddingVersion): Promise<EmbeddingVector | null> {
    const rows = await this.db.searchIndex.where('bookmarkId').equals(bookmarkId).toArray();
    return rows.flatMap(toVector).find((vector) => !vector.stale && vector.key.profileId === version.profileId && vector.key.vectorVersion === version.vectorVersion) ?? null;
  }

  async markOtherVersionsStale(version: EmbeddingVersion): Promise<number> {
    const rows = await this.db.searchIndex.where('kind').equals('embedding').toArray();
    const staleRows = rows.filter((row) => row.embeddingProfile === version.profileId && row.vectorVersion !== version.vectorVersion && !row.stale);
    if (staleRows.length === 0) return 0;
    await this.db.searchIndex.bulkPut(staleRows.map((row) => ({ ...row, stale: true })));
    return staleRows.length;
  }

  async deleteProfile(profileId: string): Promise<number> {
    const rows = await this.db.searchIndex.where('kind').equals('embedding').toArray();
    const ids = rows.filter((row) => row.embeddingProfile === profileId).map((row) => row.id);
    await this.db.searchIndex.bulkDelete(ids);
    return ids.length;
  }
}

function idFor(bookmarkId: string, key: EmbeddingKey): string {
  return `embedding:${key.profileId}:${key.vectorVersion}:${key.dimensions}:${bookmarkId}`;
}

function toVector(row: SearchIndexRecord): EmbeddingVector[] {
  if (row.kind !== 'embedding' || !row.embeddingProfile || !row.vectorVersion || !row.dimensions || !row.vector) return [];
  const inputHash = typeof row.document?.inputHash === 'string' ? row.document.inputHash : '';
  return [{ bookmarkId: row.bookmarkId, key: { profileId: row.embeddingProfile, vectorVersion: row.vectorVersion, dimensions: row.dimensions }, values: row.vector, inputHash, stale: row.stale ?? false, updatedAt: row.updatedAt }];
}
