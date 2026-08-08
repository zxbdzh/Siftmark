import { createImportGraph } from './import-graph';
import { stableStringify } from './native-exporter';
import { validateBackupManifest } from './schemas';
import type { ImportGraph, NativeBackupDataV1 } from './types';
import { parseZipContainer } from './zip-container';
import { readBlobBytes } from './blob';

export async function parseNativeBackup(
  input: string | Uint8Array | Blob
): Promise<ImportGraph> {
  if (typeof input === 'string') return parseJsonBackup(input);
  const bytes = input instanceof Blob ? await readBlobBytes(input) : input;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseZipBackup(bytes);
  return parseJsonBackup(new TextDecoder().decode(bytes));
}

async function parseJsonBackup(text: string): Promise<ImportGraph> {
  const envelope = JSON.parse(text) as { manifest?: unknown; data?: unknown };
  const data = parseData(envelope.data);
  const graph = graphFromData(data, 'unverified');
  const dataBytes = new TextEncoder().encode(stableStringify(data));
  await validateBackupManifest(
    envelope.manifest,
    new Map([['data.json', dataBytes]]),
    graph
  );
  return { ...graph, integrity: 'verified' };
}

async function parseZipBackup(bytes: Uint8Array): Promise<ImportGraph> {
  const container = await parseZipContainer(bytes);
  const dataBytes = container.files.get('data.json');
  if (!dataBytes) throw new Error('missing-backup-data');
  const data = parseData(JSON.parse(new TextDecoder().decode(dataBytes)));
  const graph = graphFromData(data, 'verified');
  const manifest = await validateBackupManifest(
    container.manifest,
    container.files,
    graph
  );
  const thumbnailEntries = [...container.files.entries()].filter(([path]) =>
    path.startsWith('thumbnails/')
  );
  if (thumbnailEntries.length !== manifest.counts.thumbnails)
    throw new Error('backup-thumbnail-count-mismatch');
  return {
    ...graph,
    thumbnailBytes: thumbnailEntries.reduce(
      (sum, [, fileBytes]) => sum + fileBytes.byteLength,
      0
    )
  };
}

function parseData(value: unknown): NativeBackupDataV1 {
  if (!value || typeof value !== 'object')
    throw new Error('invalid-backup-data');
  const data = value as Partial<NativeBackupDataV1>;
  if (data.version !== 1) throw new Error('unsupported-backup-version');
  if (
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.operations) ||
    !Array.isArray(data.history) ||
    !Array.isArray(data.blockedDomains) ||
    !data.settings ||
    typeof data.settings !== 'object'
  )
    throw new Error('invalid-backup-data');
  return data as NativeBackupDataV1;
}

function graphFromData(
  data: NativeBackupDataV1,
  integrity: ImportGraph['integrity']
): ImportGraph {
  return createImportGraph({
    format: 'siftmark',
    version: 1,
    nodes: data.nodes,
    operations: data.operations,
    settings: data.settings,
    history: data.history,
    blockedDomains: data.blockedDomains,
    integrity,
    unknownFields: []
  });
}
