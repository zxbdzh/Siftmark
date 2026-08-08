import Dexie, { type Table } from 'dexie';
import type { BookmarkMetadata } from './types';
import type {
  AnalysisProposalRecord,
  AiUsageLogRecord,
  ImportRecoveryPointRecord,
  NotificationRecord,
  OperationLogRecord,
  SearchIndexRecord,
  SoftDeletedMetadata,
  TaskRecord,
  ThumbnailRecord,
  VisitAggregate
} from './schema';
import {
  CURRENT_SCHEMA_VERSION,
  initialSchemaStores,
  schemaStores
} from './migrations';

export class SiftmarkDatabase extends Dexie {
  bookmarkMetadata!: Table<BookmarkMetadata, string>;
  thumbnails!: Table<ThumbnailRecord, string>;
  operationLog!: Table<OperationLogRecord, string>;
  tasks!: Table<TaskRecord, string>;
  searchIndex!: Table<SearchIndexRecord, string>;
  notifications!: Table<NotificationRecord, string>;
  aiUsageLog!: Table<AiUsageLogRecord, string>;
  softDeletedMetadata!: Table<SoftDeletedMetadata, string>;
  visitAggregates!: Table<VisitAggregate, string>;
  analysisProposals!: Table<AnalysisProposalRecord, string>;
  importRecoveryPoints!: Table<ImportRecoveryPointRecord, string>;

  constructor(name = 'siftmark') {
    super(name);
    this.version(1).stores(initialSchemaStores);
    this.version(CURRENT_SCHEMA_VERSION).stores(schemaStores);
  }
}

export function openSiftmarkDatabase(name = 'siftmark'): SiftmarkDatabase {
  return new SiftmarkDatabase(name);
}
