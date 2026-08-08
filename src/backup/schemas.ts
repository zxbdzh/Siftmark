import { z } from 'zod';
import { sha256Hex } from './checksum';
import type { BackupManifestV1, ImportGraph } from './types';

const countSchema = z
  .object({
    folders: z.number().int().nonnegative(),
    bookmarks: z.number().int().nonnegative(),
    metadata: z.number().int().nonnegative(),
    thumbnails: z.number().int().nonnegative()
  })
  .strict();
const fileSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative()
  })
  .strict();
const manifestSchema = z
  .object({
    format: z.literal('siftmark-backup'),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    appVersion: z.string().min(1),
    counts: countSchema,
    files: z.array(fileSchema).min(1)
  })
  .passthrough();

export async function validateBackupManifest(
  value: unknown,
  files?: Map<string, Uint8Array>,
  graph?: ImportGraph
): Promise<BackupManifestV1> {
  const manifest = manifestSchema.parse(value) as BackupManifestV1;
  const paths = new Set<string>();
  for (const file of manifest.files) {
    validateArchivePath(file.path);
    const canonical = file.path.toLocaleLowerCase();
    if (paths.has(canonical))
      throw new Error(`duplicate-backup-path:${file.path}`);
    paths.add(canonical);
  }
  if (!paths.has('data.json')) throw new Error('missing-backup-data');
  if (files) {
    for (const descriptor of manifest.files) {
      const bytes = files.get(descriptor.path);
      if (!bytes) throw new Error(`missing-backup-file:${descriptor.path}`);
      if (bytes.byteLength !== descriptor.bytes)
        throw new Error(`backup-byte-count-mismatch:${descriptor.path}`);
      if ((await sha256Hex(bytes)) !== descriptor.sha256)
        throw new Error(`backup-checksum-mismatch:${descriptor.path}`);
    }
  }
  if (graph) {
    const folders = graph.nodes.filter((node) => node.kind === 'folder').length;
    const bookmarks = graph.nodes.length - folders;
    const metadata = graph.nodes.filter((node) => node.metadata).length;
    if (
      folders !== manifest.counts.folders ||
      bookmarks !== manifest.counts.bookmarks ||
      metadata !== manifest.counts.metadata
    )
      throw new Error('backup-count-mismatch');
  }
  return manifest;
}

export function validateArchivePath(path: string): void {
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  )
    throw new Error(`unsafe-backup-path:${path}`);
}
