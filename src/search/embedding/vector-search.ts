import { EmbeddingRepository } from './embedding-repository';
import type { EmbeddingKey, EmbeddingMatch } from './types';

export class VectorSearch {
  constructor(private readonly repository: EmbeddingRepository) {}

  async query(vector: number[], key: EmbeddingKey, limit = 100): Promise<EmbeddingMatch[]> {
    if (vector.length !== key.dimensions) return [];
    const rows = await this.repository.listByKey(key);
    return rows
      .map((row) => ({ bookmarkId: row.bookmarkId, score: cosineSimilarity(vector, row.values) }))
      .filter((row) => Number.isFinite(row.score))
      .sort((left, right) => right.score - left.score || left.bookmarkId.localeCompare(right.bookmarkId))
      .slice(0, limit);
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return Number.NaN;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return Number.NaN;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}
