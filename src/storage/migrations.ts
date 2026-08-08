export const CURRENT_SCHEMA_VERSION = 2;

export const schemaStores = {
  bookmarkMetadata: '&bookmarkId, updatedAt, confidence, health',
  thumbnails: '&bookmarkId, hash, createdAt, lastAccessedAt',
  operationLog: '&id, batchId, idempotencyKey, createdAt',
  tasks: '&id, type, state, updatedAt, idempotencyKey',
  searchIndex: '&id, kind, bookmarkId, [embeddingProfile+vectorVersion+dimensions], stale, updatedAt',
  notifications: '&id, read, type, createdAt',
  aiUsageLog: '&requestId, profileId, taskType, status, createdAt',
  softDeletedMetadata: '&bookmarkId, deletedAt',
  visitAggregates: '&bookmarkId, lastVisitedAt',
  analysisProposals: '&id, bookmarkId, state, createdAt'
} as const;

export const initialSchemaStores = {
  ...schemaStores,
  searchIndex: '&bookmarkId, embeddingProfile, vectorVersion'
} as const;

export type SchemaStoreName = keyof typeof schemaStores;
