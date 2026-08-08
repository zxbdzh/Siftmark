import type { SearchDocument } from '../types';

export interface EmbeddingVersion {
  profileId: string;
  vectorVersion: string;
}

export interface EmbeddingKey extends EmbeddingVersion {
  dimensions: number;
}

export interface EmbeddingVector {
  bookmarkId: string;
  key: EmbeddingKey;
  values: number[];
  inputHash: string;
  stale: boolean;
  updatedAt: number;
}

export interface EmbeddingMatch {
  bookmarkId: string;
  score: number;
}

export interface EmbeddingPort {
  embed(texts: string[], signal: AbortSignal): Promise<number[][]>;
}

export interface EmbeddingIndexProgress {
  completed: number;
  total: number;
  state: 'succeeded' | 'paused';
  dimensions?: number;
}

export interface EmbeddingCandidate {
  document: SearchDocument;
  input: string;
  inputHash: string;
}
