import { readBlobText } from './blob';
import { createImportGraph } from './import-graph';
import {
  normalizeBookmarkRootTitle,
  validateBookmarkUrl
} from './netscape-html-importer';
import type { ImportGraph, ImportNode } from './types';

const SETTINGS = new Set([
  'llmProvider',
  'modelType',
  'selectedProvider',
  'allowNewFolders',
  'folderCreationLevel',
  'enableSmartRename',
  'renameMaxLength',
  'showFloatingButton',
  'captureNativeBookmarkEvents',
  'language',
  'theme'
]);
const LOCAL_FIELDS = new Set([
  'history',
  'bookmarkBackups',
  'snapshot',
  'bookmarks',
  'bookmarkImportState'
]);
const ROOT_FIELDS = new Set([
  'version',
  'storage',
  'local',
  'sync',
  'settings',
  'history',
  'disabledDomains',
  'bookmarkBackups',
  'snapshot',
  'bookmarks'
]);

export async function parseMarkAiBackupFile(file: Blob): Promise<ImportGraph> {
  return parseMarkAiBackup(await readBlobText(file));
}

export function parseMarkAiBackup(input: string | unknown): ImportGraph {
  const root = parseInput(input);
  const storage = asRecord(root.storage);
  const local = asRecord(storage?.local ?? root.local);
  const sync = asRecord(storage?.sync ?? root.sync);
  const explicitSettings = asRecord(root.settings);
  const unknownFields = collectUnknownFields(
    root,
    local,
    sync,
    explicitSettings
  );
  const settingsSource = {
    ...readFlatSettings(root),
    ...explicitSettings,
    ...sync
  };
  const { settings, hasApiKey } = readSettings(settingsSource);
  const history = readHistory(local?.history ?? root.history);
  const blockedDomains = readBlockedDomains(
    sync?.disabledDomains ?? root.disabledDomains
  );
  const snapshot = findSnapshot(root, local);
  const nodes = snapshot
    ? snapshotToNodes(snapshot)
    : bookmarkTreeToNodes(
        Array.isArray(root.bookmarks) ? root.bookmarks : [],
        'markai'
      );

  return createImportGraph({
    format: 'markai',
    version: readVersion(root, snapshot),
    nodes,
    settings,
    history,
    blockedDomains,
    unknownFields,
    keyPresence: hasApiKey ? 'redacted' : 'none'
  });
}

function parseInput(input: string | unknown): Record<string, unknown> {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new Error('invalid-markai-json');
    }
  }
  const record = asRecord(value);
  if (!record) throw new Error('invalid-markai-backup');
  return record;
}

function findSnapshot(
  root: Record<string, unknown>,
  local: Record<string, unknown> | null
): Record<string, unknown> | null {
  const direct = asRecord(root.snapshot) ?? asRecord(local?.snapshot);
  if (direct) return direct;
  const backups = local?.bookmarkBackups ?? root.bookmarkBackups;
  if (!Array.isArray(backups)) return null;
  for (const backup of backups) {
    const snapshot = asRecord(asRecord(backup)?.snapshot);
    if (snapshot) return snapshot;
  }
  return null;
}

function snapshotToNodes(snapshot: Record<string, unknown>): ImportNode[] {
  if (!Array.isArray(snapshot.containers))
    throw new Error('invalid-markai-snapshot');
  return bookmarkTreeToNodes(snapshot.containers, 'markai-container', true);
}

function bookmarkTreeToNodes(
  values: unknown[],
  prefix: string,
  normalizeRoots = false
): ImportNode[] {
  const nodes: ImportNode[] = [];
  let nextId = 0;
  const visit = (items: unknown[], parentSourceId: string | null): void => {
    items.forEach((value, index) => {
      const item = asRecord(value);
      if (!item) throw new Error('invalid-markai-bookmark-node');
      const sourceId = `${prefix}-${nextId++}`;
      const rawTitle = typeof item.title === 'string' ? item.title.trim() : '';
      if (typeof item.url === 'string') {
        const url = validateBookmarkUrl(item.url);
        nodes.push({
          sourceId,
          kind: 'bookmark',
          parentSourceId,
          title: rawTitle || url,
          url,
          index
        });
        return;
      }
      const title = rawTitle || '未命名文件夹';
      nodes.push({
        sourceId,
        kind: 'folder',
        parentSourceId,
        title:
          normalizeRoots && parentSourceId === null
            ? normalizeBookmarkRootTitle(title)
            : title,
        index
      });
      if (item.children !== undefined && !Array.isArray(item.children)) {
        throw new Error('invalid-markai-bookmark-children');
      }
      visit((item.children as unknown[] | undefined) ?? [], sourceId);
    });
  };
  visit(values, null);
  return nodes;
}

function readHistory(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const history: Array<Record<string, unknown>> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (
      !record ||
      typeof record.title !== 'string' ||
      typeof record.url !== 'string'
    )
      continue;
    let url: string;
    try {
      url = validateBookmarkUrl(record.url);
    } catch {
      continue;
    }
    history.push(
      Object.fromEntries(
        ['id', 'timestamp', 'title', 'category', 'bookmarkId', 'status']
          .filter((key) => isPrimitive(record[key]))
          .map((key) => [key, record[key]])
          .concat([['url', url]])
      )
    );
  }
  return history;
}

function readSettings(source: Record<string, unknown>): {
  settings: Record<string, unknown>;
  hasApiKey: boolean;
} {
  const settings: Record<string, unknown> = {};
  let hasApiKey = false;
  for (const [key, value] of Object.entries(source)) {
    if (isApiKey(key)) {
      if (typeof value === 'string' && value.trim()) hasApiKey = true;
      continue;
    }
    if (
      (SETTINGS.has(key) || /^(model|baseUrl)_[a-z0-9_-]+$/i.test(key)) &&
      isPrimitive(value)
    ) {
      settings[key] = value;
    }
  }
  return { settings, hasApiKey };
}

function readFlatSettings(
  root: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(root).filter(
      ([key]) => SETTINGS.has(key) || /^(apiKey|model|baseUrl)_/i.test(key)
    )
  );
}

function readBlockedDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const domains = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const domain = item
      .trim()
      .toLocaleLowerCase()
      .replace(/^\.+|\.+$/g, '');
    if (
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
        domain
      )
    ) {
      domains.add(domain);
    }
  }
  return [...domains];
}

function collectUnknownFields(
  root: Record<string, unknown>,
  local: Record<string, unknown> | null,
  sync: Record<string, unknown> | null,
  explicitSettings: Record<string, unknown> | null
): string[] {
  const unknown = Object.keys(root).filter(
    (key) =>
      !ROOT_FIELDS.has(key) &&
      !SETTINGS.has(key) &&
      !/^(apiKey|model|baseUrl)_/i.test(key)
  );
  if (local) {
    for (const key of Object.keys(local)) {
      if (!LOCAL_FIELDS.has(key)) unknown.push(`storage.local.${key}`);
    }
  }
  for (const [source, prefix] of [
    [sync, 'storage.sync'],
    [explicitSettings, 'settings']
  ] as const) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      if (
        !SETTINGS.has(key) &&
        !/^(apiKey|model|baseUrl)_/i.test(key) &&
        key !== 'disabledDomains'
      ) {
        unknown.push(`${prefix}.${key}`);
      }
    }
  }
  return [...new Set(unknown)].sort();
}

function readVersion(
  root: Record<string, unknown>,
  snapshot: Record<string, unknown> | null
): number {
  const value = root.version ?? snapshot?.version;
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPrimitive(
  value: unknown
): value is string | number | boolean | null {
  return (
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  );
}

function isApiKey(key: string): boolean {
  return /^api.?key(?:_|$)/i.test(key);
}
