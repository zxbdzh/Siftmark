import { describe, expect, it } from 'vitest';
import { createImportGraph } from '../../../src/backup/import-graph';
import { validateBackupManifest } from '../../../src/backup/schemas';
import { sha256Hex } from '../../../src/backup/checksum';

async function validPackage() {
  const data = new TextEncoder().encode('{"version":1}');
  return {
    data,
    manifest: {
      format: 'siftmark-backup',
      version: 1,
      exportedAt: '2026-08-08T00:00:00.000Z',
      appVersion: '0.1.0',
      counts: { folders: 1, bookmarks: 1, metadata: 1, thumbnails: 0 },
      files: [
        {
          path: 'data.json',
          sha256: await sha256Hex(data),
          bytes: data.byteLength
        }
      ]
    }
  };
}

describe('backup schemas', () => {
  it('accepts a valid version 1 package and verifies exact bytes/counts', async () => {
    const { data, manifest } = await validPackage();
    const graph = createImportGraph({
      format: 'siftmark',
      version: 1,
      nodes: [
        {
          sourceId: 'folder',
          kind: 'folder',
          parentSourceId: null,
          title: '资料',
          index: 0
        },
        {
          sourceId: 'bookmark',
          kind: 'bookmark',
          parentSourceId: 'folder',
          title: '示例',
          url: 'https://example.com',
          index: 0,
          metadata: { tags: ['测试'] }
        }
      ]
    });
    await expect(
      validateBackupManifest(manifest, new Map([['data.json', data]]), graph)
    ).resolves.toMatchObject({ version: 1 });
  });

  it.each([
    [
      'unknown version',
      (manifest: Record<string, unknown>) => ({ ...manifest, version: 2 })
    ],
    [
      'duplicate paths',
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        files: [
          ...(manifest.files as unknown[]),
          (manifest.files as unknown[])[0]
        ]
      })
    ],
    [
      'path traversal',
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        files: [
          {
            ...(manifest.files as Array<Record<string, unknown>>)[0],
            path: '../data.json'
          }
        ]
      })
    ],
    [
      'missing data',
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        files: [
          {
            ...(manifest.files as Array<Record<string, unknown>>)[0],
            path: 'other.json'
          }
        ]
      })
    ]
  ])('rejects %s', async (_name, mutate) => {
    const { data, manifest } = await validPackage();
    await expect(
      validateBackupManifest(mutate(manifest), new Map([['data.json', data]]))
    ).rejects.toThrow();
  });

  it('rejects checksum and count mismatches', async () => {
    const { data, manifest } = await validPackage();
    await expect(
      validateBackupManifest(
        manifest,
        new Map([['data.json', new TextEncoder().encode('tampered')]])
      )
    ).rejects.toThrow();
    const graph = createImportGraph({
      format: 'siftmark',
      version: 1,
      nodes: []
    });
    await expect(
      validateBackupManifest(manifest, new Map([['data.json', data]]), graph)
    ).rejects.toThrow('backup-count-mismatch');
  });

  it('rejects invalid URLs and cyclic parent graphs', () => {
    expect(() =>
      createImportGraph({
        format: 'siftmark',
        version: 1,
        nodes: [
          {
            sourceId: 'bad',
            kind: 'bookmark',
            parentSourceId: null,
            title: 'Bad',
            url: 'not a url',
            index: 0
          }
        ]
      })
    ).toThrow('invalid-bookmark-url');
    expect(() =>
      createImportGraph({
        format: 'siftmark',
        version: 1,
        nodes: [
          {
            sourceId: 'a',
            kind: 'folder',
            parentSourceId: 'b',
            title: 'A',
            index: 0
          },
          {
            sourceId: 'b',
            kind: 'folder',
            parentSourceId: 'a',
            title: 'B',
            index: 0
          }
        ]
      })
    ).toThrow('cyclic-parent');
  });
});
