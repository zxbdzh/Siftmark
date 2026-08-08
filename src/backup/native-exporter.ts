import type { BookmarkNode } from '../bookmarks/types';
import { isBookmark } from '../bookmarks/types';
import type { ThumbnailRecord, OperationLogRecord } from '../storage/schema';
import type { BookmarkMetadata } from '../storage/types';
import { sha256Hex } from './checksum';
import { createZipContainer } from './zip-container';
import type { BackupManifestV1, ImportNode, NativeBackupDataV1 } from './types';
import { readBlobBytes } from './blob';

export interface NativeExportInput {
  nodes: BookmarkNode[];
  metadata: Map<string, BookmarkMetadata>;
  operations?: OperationLogRecord[];
  settings?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
  blockedDomains?: string[];
  thumbnails?: ThumbnailRecord[];
  selectedRootIds?: string[];
  includeThumbnails?: boolean;
  appVersion: string;
  exportedAt?: Date;
}

export interface NativeBackupExport {
  manifest: BackupManifestV1;
  data: NativeBackupDataV1;
  files: Map<string, Uint8Array>;
  json: Blob;
  zip: Blob;
  estimatedThumbnailBytes: number;
}

export async function exportNativeBackup(
  input: NativeExportInput
): Promise<NativeBackupExport> {
  const selected = selectScope(input.nodes, input.selectedRootIds);
  const selectedIds = new Set(selected.map((node) => node.id));
  const importNodes: ImportNode[] = selected.map((node) => ({
    sourceId: node.id,
    kind: isBookmark(node) ? 'bookmark' : 'folder',
    parentSourceId: selectedIds.has(node.parentId) ? node.parentId : null,
    title: node.title,
    ...(node.url ? { url: node.url } : {}),
    index: node.index,
    ...(input.metadata.get(node.id)
      ? { metadata: input.metadata.get(node.id) }
      : {})
  }));
  const data: NativeBackupDataV1 = {
    version: 1,
    nodes: importNodes,
    operations: (input.operations ?? []).filter((operation) =>
      selectedIds.has(operation.bookmarkId)
    ),
    settings: redactSecrets(input.settings ?? {}) as Record<string, unknown>,
    history: input.history ?? [],
    blockedDomains: input.blockedDomains ?? []
  };
  const dataBytes = new TextEncoder().encode(stableStringify(data));
  const files = new Map<string, Uint8Array>([['data.json', dataBytes]]);
  const selectedThumbnails = (input.thumbnails ?? []).filter(
    (thumbnail) =>
      selectedIds.has(thumbnail.bookmarkId) &&
      thumbnail.state === 'ready' &&
      thumbnail.blob
  );
  const estimatedThumbnailBytes = selectedThumbnails.reduce(
    (sum, thumbnail) => sum + (thumbnail.blob?.size ?? 0),
    0
  );
  if (input.includeThumbnails)
    for (const thumbnail of selectedThumbnails)
      files.set(
        `thumbnails/${thumbnail.bookmarkId}-${thumbnail.hash ?? 'image'}.webp`,
        await readBlobBytes(thumbnail.blob!)
      );
  const descriptors = await Promise.all(
    [...files].map(async ([path, bytes]) => ({
      path,
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength
    }))
  );
  descriptors.sort((left, right) => left.path.localeCompare(right.path));
  const manifest: BackupManifestV1 = {
    format: 'siftmark-backup',
    version: 1,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    appVersion: input.appVersion,
    counts: {
      folders: importNodes.filter((node) => node.kind === 'folder').length,
      bookmarks: importNodes.filter((node) => node.kind === 'bookmark').length,
      metadata: importNodes.filter((node) => node.metadata).length,
      thumbnails: input.includeThumbnails ? selectedThumbnails.length : 0
    },
    files: descriptors
  };
  const jsonManifest: BackupManifestV1 = {
    ...manifest,
    counts: { ...manifest.counts, thumbnails: 0 },
    files: descriptors.filter((descriptor) => descriptor.path === 'data.json')
  };
  const jsonBytes = new TextEncoder().encode(
    stableStringify({ manifest: jsonManifest, data })
  );
  const zipBytes = await createZipContainer(manifest, files);
  return {
    manifest,
    data,
    files,
    json: new Blob([Uint8Array.from(jsonBytes).buffer], {
      type: 'application/json'
    }),
    zip: new Blob([Uint8Array.from(zipBytes).buffer], {
      type: 'application/zip'
    }),
    estimatedThumbnailBytes
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)])
    );
  return value;
}

function selectScope(nodes: BookmarkNode[], roots?: string[]): BookmarkNode[] {
  if (!roots?.length) return nodes;
  const selected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes)
      if (selected.has(node.parentId) && !selected.has(node.id)) {
        selected.add(node.id);
        changed = true;
      }
  }
  return nodes.filter((node) => selected.has(node.id));
}

function redactSecrets(value: unknown, key = ''): unknown {
  if (/api.?key/i.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).flatMap(([childKey, child]) => {
        const redacted = redactSecrets(child, childKey);
        return redacted === undefined ? [] : [[childKey, redacted]];
      })
    );
  return value;
}
