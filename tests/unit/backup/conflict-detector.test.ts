import { describe, expect, it } from 'vitest';
import { detectImportConflicts } from '../../../src/backup/conflict-detector';
import type { ImportGraph } from '../../../src/backup/types';
import type { BookmarkNode } from '../../../src/bookmarks/types';
import type { BookmarkMetadata } from '../../../src/storage/types';

describe('import conflict detection', () => {
  it('classifies source, URL, normalized URL, folder-title, and metadata-only conflicts safely', () => {
    const graph: ImportGraph = {
      format: 'siftmark',
      version: 1,
      nodes: [
        {
          sourceId: 'exact',
          kind: 'bookmark',
          parentSourceId: null,
          title: 'Exact',
          url: 'https://example.com/exact',
          index: 0
        },
        {
          sourceId: 'normalized',
          kind: 'bookmark',
          parentSourceId: null,
          title: 'Tracked',
          url: 'https://example.com/page?utm_source=backup',
          index: 1
        },
        {
          sourceId: 'folder',
          kind: 'folder',
          parentSourceId: null,
          title: 'Docs',
          index: 2
        },
        {
          sourceId: 'metadata',
          kind: 'bookmark',
          parentSourceId: null,
          title: 'Metadata',
          url: 'https://example.com/metadata',
          index: 3,
          metadata: { tags: ['imported'] }
        },
        {
          sourceId: 'duplicate',
          kind: 'folder',
          parentSourceId: null,
          title: 'One',
          index: 4
        },
        {
          sourceId: 'duplicate',
          kind: 'folder',
          parentSourceId: null,
          title: 'Two',
          index: 5
        }
      ],
      operations: [],
      settings: {},
      history: [],
      blockedDomains: [],
      unknownFields: [],
      integrity: 'verified',
      keyPresence: 'none',
      thumbnailBytes: 0
    };
    const existing: BookmarkNode[] = [
      {
        id: 'b-exact',
        parentId: 'root',
        index: 0,
        title: 'Exact',
        url: 'https://example.com/exact'
      },
      {
        id: 'b-normalized',
        parentId: 'root',
        index: 1,
        title: 'Page',
        url: 'https://example.com/page'
      },
      { id: 'f-docs', parentId: 'root', index: 2, title: 'Docs' },
      {
        id: 'b-metadata',
        parentId: 'root',
        index: 3,
        title: 'Metadata',
        url: 'https://example.com/metadata'
      }
    ];
    const metadata = new Map<string, BookmarkMetadata>([
      [
        'b-metadata',
        {
          bookmarkId: 'b-metadata',
          summary: '',
          tags: ['existing'],
          note: '',
          confidence: 'unknown',
          reason: '',
          health: 'unchecked',
          updatedAt: 1
        }
      ]
    ]);

    const conflicts = detectImportConflicts(graph, existing, metadata);

    expect(conflicts.map((conflict) => conflict.kind)).toEqual([
      'exact-url',
      'normalized-url',
      'folder-title',
      'metadata-only',
      'duplicate-source-node'
    ]);
    expect(
      conflicts.every(
        (conflict) => conflict.defaultDecision === 'keep-existing'
      )
    ).toBe(true);
    expect(
      conflicts.find((conflict) => conflict.sourceId === 'metadata')
    ).toMatchObject({
      existingBookmarkId: 'b-metadata',
      mergeableFields: ['tags']
    });
  });
});
