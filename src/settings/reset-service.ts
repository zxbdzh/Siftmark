import type { SiftmarkDatabase } from '../storage/database';

export type ResetScope =
  | 'cache-thumbnails'
  | 'ai-metadata-index'
  | 'history-tasks'
  | 'model-configuration'
  | 'all-siftmark-data';

export interface ResetStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ResetPreviewGroup {
  id: string;
  label: string;
  rows: number;
  bytes: number;
}

export interface ResetPreview {
  scope: ResetScope;
  rows: number;
  bytes: number;
  groups: ResetPreviewGroup[];
  requiresConfirmation: boolean;
}

export type ResetExecutionResult =
  | { ok: true; removedRows: number; removedKeys: number }
  | { ok: false; code: 'confirmation-required' };

export interface ResetExecutionOptions {
  confirmationPhrase?: string;
}

export const RESET_CONFIRMATION_PHRASE = '重置 Siftmark';
const encoder = new TextEncoder();
const modelConfigurationKeys = [
  'siftmark.ai.profiles.v1',
  'siftmark.settings.profile-assignments.v1'
] as const;
const scopeTables: Record<'ai-metadata-index' | 'history-tasks', string[]> = {
  'ai-metadata-index': [
    'bookmarkMetadata',
    'softDeletedMetadata',
    'searchIndex',
    'analysisProposals'
  ],
  'history-tasks': [
    'operationLog',
    'tasks',
    'notifications',
    'aiUsageLog',
    'visitAggregates',
    'importRecoveryPoints'
  ]
};

const tableLabels: Record<string, string> = {
  bookmarkMetadata: '书签元数据',
  thumbnails: '缩略图缓存',
  operationLog: '操作历史',
  tasks: '后台任务',
  searchIndex: '搜索索引',
  notifications: '通知记录',
  aiUsageLog: '模型用量记录',
  softDeletedMetadata: '软删除元数据',
  visitAggregates: '访问统计',
  analysisProposals: 'AI 审核提案',
  importRecoveryPoints: '导入恢复点',
  specialFolderPlacements: '归档与回收位置',
  captureSessions: '收藏 Agent 会话',
  capturePreferences: 'Agent 收藏偏好'
};

export class ResetService {
  constructor(
    private readonly database: SiftmarkDatabase,
    private readonly storage: ResetStorageArea
  ) {}

  async preview(scope: ResetScope): Promise<ResetPreview> {
    if (scope === 'cache-thumbnails') {
      const group = await this.previewTable('thumbnails');
      return {
        scope,
        rows: group.rows,
        bytes: group.bytes,
        groups: [group],
        requiresConfirmation: false
      };
    }
    if (scope === 'ai-metadata-index' || scope === 'history-tasks') {
      const groups = (
        await Promise.all(
          scopeTables[scope].map((tableName) => this.previewTable(tableName))
        )
      ).filter((group) => group.rows > 0);
      return summarizePreview(scope, groups, false);
    }
    if (scope === 'model-configuration') {
      const stored = await this.storage.get([...modelConfigurationKeys]);
      const entries = modelConfigurationKeys.flatMap((key) =>
        stored[key] === undefined ? [] : [[key, stored[key]] as const]
      );
      return summarizePreview(
        scope,
        entries.length
          ? [
              {
                id: 'local-storage',
                label: '模型档案与任务分配',
                rows: entries.length,
                bytes: entries.reduce(
                  (total, [, value]) => total + valueBytes(value),
                  0
                )
              }
            ]
          : [],
        false
      );
    }
    if (scope !== 'all-siftmark-data')
      throw new Error(`Unsupported reset scope: ${scope}`);
    const tableGroups = await Promise.all(
      this.database.tables.map((table) => this.previewTable(table.name))
    );
    const stored = await this.storage.get(null);
    const siftmarkEntries = Object.entries(stored).filter(([key]) =>
      key.startsWith('siftmark.')
    );
    const storageGroup: ResetPreviewGroup = {
      id: 'local-storage',
      label: '本地设置与模型档案',
      rows: siftmarkEntries.length,
      bytes: siftmarkEntries.reduce(
        (total, [, value]) => total + valueBytes(value),
        0
      )
    };
    const groups = [
      ...tableGroups.filter((group) => group.rows > 0),
      storageGroup
    ].filter((group) => group.rows > 0);
    return summarizePreview(scope, groups, true);
  }

  async execute(
    scope: ResetScope,
    options: ResetExecutionOptions = {}
  ): Promise<ResetExecutionResult> {
    if (
      scope === 'all-siftmark-data' &&
      options.confirmationPhrase !== RESET_CONFIRMATION_PHRASE
    ) {
      return { ok: false, code: 'confirmation-required' };
    }
    const preview = await this.preview(scope);
    if (scope === 'cache-thumbnails') {
      await this.database.thumbnails.clear();
      return { ok: true, removedRows: preview.rows, removedKeys: 0 };
    }
    if (scope === 'ai-metadata-index' || scope === 'history-tasks') {
      const tables = scopeTables[scope].map((tableName) =>
        this.database.table(tableName)
      );
      await this.database.transaction('rw', tables, async () => {
        await Promise.all(tables.map((table) => table.clear()));
      });
      return { ok: true, removedRows: preview.rows, removedKeys: 0 };
    }
    if (scope === 'model-configuration') {
      const stored = await this.storage.get([...modelConfigurationKeys]);
      const keys = modelConfigurationKeys.filter(
        (key) => stored[key] !== undefined
      );
      if (keys.length > 0) await this.storage.remove([...keys]);
      return { ok: true, removedRows: 0, removedKeys: keys.length };
    }
    const stored = await this.storage.get(null);
    const keys = Object.keys(stored).filter((key) =>
      key.startsWith('siftmark.')
    );
    const removedRows = (
      await Promise.all(this.database.tables.map((table) => table.count()))
    ).reduce((total, count) => total + count, 0);
    await this.database.transaction('rw', this.database.tables, async () => {
      await Promise.all(this.database.tables.map((table) => table.clear()));
    });
    if (keys.length > 0) await this.storage.remove(keys);
    return { ok: true, removedRows, removedKeys: keys.length };
  }

  private async previewTable(tableName: string): Promise<ResetPreviewGroup> {
    const table = this.database.table(tableName);
    const rows = await table.toArray();
    const bytes =
      tableName === 'thumbnails'
        ? rows.reduce(
            (total, row) =>
              total + ((row as { blob?: { size?: number } }).blob?.size ?? 0),
            0
          )
        : rows.reduce((total, row) => total + valueBytes(row), 0);
    return {
      id: tableName,
      label: tableLabels[tableName] ?? tableName,
      rows: rows.length,
      bytes
    };
  }
}

function valueBytes(value: unknown): number {
  if (typeof value === 'string') return encoder.encode(value).byteLength;
  if (value instanceof Blob) return value.size;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : encoder.encode(serialized).byteLength;
}

function summarizePreview(
  scope: ResetScope,
  groups: ResetPreviewGroup[],
  requiresConfirmation: boolean
): ResetPreview {
  return {
    scope,
    rows: groups.reduce((total, group) => total + group.rows, 0),
    bytes: groups.reduce((total, group) => total + group.bytes, 0),
    groups,
    requiresConfirmation
  };
}
