import JSZip from 'jszip';
import { validateArchivePath } from './schemas';
import type { BackupManifestV1 } from './types';

export async function createZipContainer(
  manifest: BackupManifestV1,
  files: Map<string, Uint8Array>
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  for (const [path, bytes] of files) {
    validateArchivePath(path);
    zip.file(path, Uint8Array.from(bytes).buffer);
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

export async function parseZipContainer(
  bytes: Uint8Array
): Promise<{ manifest: unknown; files: Map<string, Uint8Array> }> {
  const names = readCentralDirectoryNames(bytes);
  const seen = new Set<string>();
  for (const name of names) {
    const path = name.endsWith('/') ? name.slice(0, -1) : name;
    validateArchivePath(path);
    const canonical = path.toLocaleLowerCase();
    if (seen.has(canonical)) throw new Error(`duplicate-backup-path:${name}`);
    seen.add(canonical);
  }
  const zip = await JSZip.loadAsync(bytes, {
    checkCRC32: true,
    createFolders: false
  });
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('missing-backup-manifest');
  const manifest = JSON.parse(await manifestEntry.async('string')) as unknown;
  const files = new Map<string, Uint8Array>();
  for (const [safeName, entry] of Object.entries(zip.files)) {
    if (entry.dir || safeName === 'manifest.json') continue;
    const originalName = entry.unsafeOriginalName ?? safeName;
    validateArchivePath(originalName);
    files.set(originalName, await entry.async('uint8array'));
  }
  return { manifest, files };
}

function readCentralDirectoryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (let offset = 0; offset + 46 <= bytes.byteLength;) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength;
    if (end > bytes.byteLength) throw new Error('invalid-zip-directory');
    names.push(decoder.decode(bytes.subarray(offset + 46, end)));
    offset = end + extraLength + commentLength;
  }
  return names;
}
