import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPTURE_SESSION_TTL_MS,
  DexieCaptureSessionRepository,
  type CaptureSession
} from '../../../src/capture-agent';
import { openSiftmarkDatabase } from '../../../src/storage/database';

const databaseNames: string[] = [];

describe('DexieCaptureSessionRepository', () => {
  afterEach(async () => {
    await Promise.all(
      databaseNames.splice(0).map((name) => Dexie.delete(name))
    );
  });

  it('persists pending sessions and lists newest work first', async () => {
    const { database, repository } = createRepository('list');
    await repository.put(session({ id: 'old', updatedAt: 1 }));
    await repository.put(session({ id: 'new', updatedAt: 2 }));

    await expect(repository.listPending()).resolves.toMatchObject([
      { id: 'new' },
      { id: 'old' }
    ]);
    database.close();
  });

  it('keeps dialogue while pending and deletes it on resolution', async () => {
    const { database, repository } = createRepository('resolve');
    await repository.put(session());
    await repository.appendMessage('session', {
      id: 'message',
      role: 'user',
      text: '放到开发目录',
      createdAt: 2
    });

    expect(await repository.get('session')).toMatchObject({
      state: 'adjusting',
      messages: [{ text: '放到开发目录' }]
    });

    await repository.resolve('session', 'allowed', 3, 'batch');
    expect(await repository.get('session')).toMatchObject({
      state: 'applied',
      resolution: 'allowed',
      operationBatchId: 'batch',
      messages: []
    });
    database.close();
  });

  it('expires only unresolved sessions after seven days and erases dialogue', async () => {
    const { database, repository } = createRepository('expiry');
    const expiredAt = 1 + CAPTURE_SESSION_TTL_MS;
    await repository.put(
      session({
        messages: [
          { id: 'm', role: 'user', text: 'private conversation', createdAt: 2 }
        ]
      })
    );
    await repository.put(
      session({
        id: 'resolved',
        state: 'applied',
        resolution: 'auto',
        messages: [],
        expiresAt: expiredAt
      })
    );

    await expect(repository.expirePending(expiredAt)).resolves.toBe(1);
    expect(await repository.get('session')).toMatchObject({
      state: 'expired',
      resolution: 'expired',
      messages: []
    });
    expect((await repository.get('resolved'))?.state).toBe('applied');
    database.close();
  });
});

function createRepository(suffix: string) {
  const name = `siftmark-capture-session-${suffix}-${crypto.randomUUID()}`;
  databaseNames.push(name);
  const database = openSiftmarkDatabase(name);
  return {
    database,
    repository: new DexieCaptureSessionRepository(database)
  };
}

function session(patch: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: 'session',
    bookmarkId: 'bookmark',
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: 'bookmark',
      parentId: 'inbox',
      index: 0,
      title: 'Title',
      url: 'https://example.test/article'
    },
    state: 'pending',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 1 + CAPTURE_SESSION_TTL_MS,
    ...patch,
    activities: patch.activities ?? []
  };
}
