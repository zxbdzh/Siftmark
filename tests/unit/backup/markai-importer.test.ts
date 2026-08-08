import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseMarkAiBackup,
  parseMarkAiBackupFile
} from '../../../src/backup/markai-importer';

const fixturePath = resolve('tests/fixtures/backup/markai-backup.json');

describe('MarkAI migration', () => {
  it('maps bookmark snapshots, compatible history, settings, and blocked domains', async () => {
    const fixture = await readFile(fixturePath, 'utf8');
    const graph = await parseMarkAiBackupFile(
      new Blob([fixture], { type: 'application/json' })
    );

    expect(graph).toMatchObject({
      format: 'markai',
      version: 1,
      keyPresence: 'redacted',
      blockedDomains: ['example.com', 'ads.example.org']
    });
    expect(graph.nodes.map(({ title, kind }) => ({ title, kind }))).toEqual([
      { title: '书签栏', kind: 'folder' },
      { title: '开发', kind: 'folder' },
      { title: '示例', kind: 'bookmark' }
    ]);
    expect(graph.history).toEqual([
      expect.objectContaining({
        title: 'Siftmark',
        url: 'https://example.com',
        status: 'success'
      })
    ]);
    expect(graph.settings).toMatchObject({
      llmProvider: 'custom',
      modelType: 'custom',
      selectedProvider: 'deepseek',
      model_deepseek: 'deepseek-chat',
      allowNewFolders: true
    });
    expect(JSON.stringify(graph)).not.toContain('must-not-migrate');
    expect(graph.unknownFields).toEqual(
      expect.arrayContaining([
        'futureRoot',
        'storage.local.localOnlyUnknown',
        'storage.sync.futureSetting'
      ])
    );
  });

  it('accepts a direct snapshot and handles absent optional keys', () => {
    const graph = parseMarkAiBackup({
      snapshot: {
        version: 1,
        containers: [{ key: '2', title: 'Other bookmarks', children: [] }]
      }
    });

    expect(graph.nodes).toEqual([
      expect.objectContaining({
        kind: 'folder',
        title: '其他书签',
        parentSourceId: null
      })
    ]);
    expect(graph.settings).toEqual({});
    expect(graph.history).toEqual([]);
    expect(graph.blockedDomains).toEqual([]);
    expect(graph.keyPresence).toBe('none');
  });

  it('rejects malformed JSON, invalid bookmark URLs, and invalid top-level values', () => {
    expect(() => parseMarkAiBackup('{')).toThrow('invalid-markai-json');
    expect(() => parseMarkAiBackup(null)).toThrow('invalid-markai-backup');
    expect(() =>
      parseMarkAiBackup({
        bookmarks: [{ title: 'Bad', url: 'javascript:alert(1)' }]
      })
    ).toThrow('unsupported-bookmark-url');
  });
});
