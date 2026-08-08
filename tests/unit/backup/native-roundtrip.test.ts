import { describe, expect, it } from 'vitest';
import { exportNativeBackup } from '../../../src/backup/native-exporter';
import { parseNativeBackup } from '../../../src/backup/native-importer';
import { readBlobText } from '../../../src/backup/blob';

const nodes = [
  { id: 'root', parentId: '0', index: 0, title: '资料' },
  { id: 'nested', parentId: 'root', index: 0, title: '技术' },
  {
    id: 'bookmark',
    parentId: 'nested',
    index: 0,
    title: 'Siftmark',
    url: 'https://example.com',
    dateAdded: 1
  }
];

describe('native backup round trip', () => {
  it('round trips selected nested data through JSON and ZIP with optional thumbnails', async () => {
    const metadata = new Map([
      [
        'bookmark',
        {
          bookmarkId: 'bookmark',
          summary: '中文摘要',
          tags: ['备份'],
          note: '# 笔记',
          confidence: 'high' as const,
          reason: '测试',
          health: 'healthy' as const,
          updatedAt: 1
        }
      ]
    ]);
    const thumbnails = [
      {
        bookmarkId: 'bookmark',
        blob: new Blob(['one'], { type: 'image/webp' }),
        hash: 'a',
        state: 'ready' as const,
        createdAt: 1,
        lastAccessedAt: 1
      },
      {
        bookmarkId: 'other',
        blob: new Blob(['two'], { type: 'image/webp' }),
        hash: 'b',
        state: 'ready' as const,
        createdAt: 1,
        lastAccessedAt: 1
      }
    ];
    const exported = await exportNativeBackup({
      nodes,
      metadata,
      selectedRootIds: ['root'],
      operations: [
        {
          id: 'op',
          type: 'metadata',
          bookmarkId: 'bookmark',
          before: {},
          after: {},
          idempotencyKey: 'key',
          createdAt: 1
        }
      ],
      thumbnails,
      includeThumbnails: true,
      settings: { profiles: [{ apiKey: 'secret', model: 'local' }] },
      appVersion: '0.1.0',
      exportedAt: new Date('2026-08-08T00:00:00Z')
    });
    expect(exported.estimatedThumbnailBytes).toBe(3);
    expect(JSON.stringify(exported.data)).not.toContain('secret');
    const fromJson = await parseNativeBackup(await readBlobText(exported.json));
    const fromZip = await parseNativeBackup(exported.zip);
    expect(fromJson.nodes).toEqual(fromZip.nodes);
    expect(fromZip).toMatchObject({ integrity: 'verified', thumbnailBytes: 3 });
    expect(fromZip.operations).toHaveLength(1);
  });

  it('rejects checksum failures and excludes thumbnails by default', async () => {
    const exported = await exportNativeBackup({
      nodes,
      metadata: new Map(),
      thumbnails: [
        {
          bookmarkId: 'bookmark',
          blob: new Blob(['image']),
          hash: 'a',
          state: 'ready',
          createdAt: 1,
          lastAccessedAt: 1
        }
      ],
      appVersion: '0.1.0'
    });
    expect(exported.manifest.counts.thumbnails).toBe(0);
    const envelope = JSON.parse(await readBlobText(exported.json));
    envelope.data.nodes[0].title = '篡改';
    await expect(parseNativeBackup(JSON.stringify(envelope))).rejects.toThrow(
      'backup-checksum-mismatch'
    );
  });
});
