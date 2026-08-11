import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DexieCaptureLearningRepository,
  DexieCaptureSessionRepository,
  type CaptureLearningMemory,
  type CaptureSession
} from '../../../src/capture-agent';
import { openSiftmarkDatabase } from '../../../src/storage/database';

const databaseNames: string[] = [];

describe('DexieCaptureLearningRepository', () => {
  afterEach(async () => {
    await Promise.all(
      databaseNames.splice(0).map((name) => Dexie.delete(name))
    );
  });

  it('atomically stores memory and marks its source sessions reviewed', async () => {
    const name = `siftmark-learning-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = openSiftmarkDatabase(name);
    const sessions = new DexieCaptureSessionRepository(database);
    const learning = new DexieCaptureLearningRepository(database);
    await sessions.put(resolvedSession());

    await expect(learning.listUnreviewed(8)).resolves.toMatchObject([
      { id: 'session' }
    ]);
    await learning.commit({
      memories: [memory()],
      sessionIds: ['session'],
      reviewedAt: 20
    });

    await expect(learning.getMemory('sleep-review:example.test')).resolves.toMatchObject({
      evidenceCount: 3,
      reviewSummary: '连续批准归入开发目录'
    });
    await expect(learning.listUnreviewed(8)).resolves.toEqual([]);
    await expect(sessions.get('session')).resolves.toMatchObject({
      updatedAt: 10,
      learningReview: {
        reviewedAt: 20,
        outcome: 'learned',
        memoryIds: ['sleep-review:example.test']
      }
    });
    database.close();
  });
});

function memory(): CaptureLearningMemory {
  return {
    id: 'sleep-review:example.test',
    kind: 'learned',
    domain: 'example.test',
    action: 'prefer-folder',
    destinationFolderId: 'dev',
    destinationPath: ['开发'],
    source: 'sleep-review',
    sourceSessionId: 'session',
    reviewSummary: '连续批准归入开发目录',
    evidenceCount: 3,
    confidence: 'high',
    reviewedAt: 20,
    createdAt: 20,
    updatedAt: 20
  };
}

function resolvedSession(): CaptureSession {
  return {
    id: 'session',
    bookmarkId: 'bookmark',
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: 'bookmark',
      parentId: 'inbox',
      index: 0,
      title: 'Example',
      url: 'https://example.test'
    },
    state: 'applied',
    resolution: 'allowed',
    resolvedAt: 10,
    plan: {
      destination: {
        folderId: 'dev',
        path: [{ id: 'dev', title: '开发' }],
        newFolders: []
      },
      title: 'Example',
      tags: [],
      summary: '',
      confidence: 'high',
      reason: '开发内容',
      relatedBookmarks: [],
      generatedAt: 1
    },
    activities: [],
    messages: [],
    createdAt: 1,
    updatedAt: 10,
    expiresAt: 100
  };
}
