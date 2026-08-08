import type { Confidence, HealthStatus } from '../storage/types';

export interface SearchDocument {
  bookmarkId: string;
  title: string;
  url: string;
  folderId: string;
  folderPath: string;
  tags: string[];
  summary: string;
  note: string;
  health: HealthStatus;
  confidence: Confidence;
  createdAt: number;
  updatedAt: number;
  lastVisitedAt?: number;
}

export interface SearchFilters {
  folderId?: string;
  domain?: string;
  tag?: string;
  status?: HealthStatus;
  createdAfter?: number;
  createdBefore?: number;
}

export interface SearchQuery { text: string; filters: SearchFilters; limit?: number }
export interface SearchResult { bookmarkId: string; score: number; title: string; url: string; mode: 'local' | 'semantic' | 'fused' }
