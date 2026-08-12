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

  it('keeps the complete dialogue after resolution for the Agent record', async () => {
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
      messages: [{ text: '放到开发目录' }]
    });
    database.close();
  });

  it('clears only ended records and preserves active or retryable work', async () => {
    const { database, repository } = createRepository('clear-ended');
    await repository.put(
      session({ id: 'applied', state: 'applied', resolution: 'auto' })
    );
    await repository.put(
      session({ id: 'rejected', state: 'rejected', resolution: 'rejected' })
    );
    await repository.put(
      session({
        id: 'failed',
        state: 'failed',
        failure: {
          kind: 'network',
          message: 'Provider request aborted',
          retryable: true,
          retryCount: 1
        }
      })
    );
    await repository.put(session({ id: 'pending', state: 'pending' }));

    await expect(repository.clearEnded()).resolves.toBe(2);
    await expect(repository.get('applied')).resolves.toBeNull();
    await expect(repository.get('rejected')).resolves.toBeNull();
    await expect(repository.get('failed')).resolves.toMatchObject({
      state: 'failed'
    });
    await expect(repository.get('pending')).resolves.toMatchObject({
      state: 'pending'
    });
    database.close();
  });

  it('refuses single-record deletion until the session has ended', async () => {
    const { database, repository } = createRepository('remove-ended');
    await repository.put(session({ id: 'failed', state: 'failed' }));
    await repository.put(
      session({ id: 'ended', state: 'ended', resolution: 'ended' })
    );

    await expect(repository.removeEnded('failed')).resolves.toBe(false);
    await expect(repository.removeEnded('ended')).resolves.toBe(true);
    await expect(repository.get('failed')).resolves.not.toBeNull();
    await expect(repository.get('ended')).resolves.toBeNull();
    database.close();
  });

  it('reopens a failed session when a new message is appended', async () => {
    const { database, repository } = createRepository('failed-message');
    await repository.put(
      session({
        state: 'failed',
        failure: {
          kind: 'schema',
          message: 'Provider returned no text result',
          retryable: false,
          retryCount: 0
        },
        messages: [
          { id: 'old', role: 'user', text: '放到开发目录', createdAt: 1 }
        ]
      })
    );

    await expect(
      repository.appendMessage('session', {
        id: 'new',
        role: 'user',
        text: '不要新建目录，继续尝试',
        createdAt: 2
      })
    ).resolves.toMatchObject({
      state: 'adjusting',
      failure: { kind: 'schema' },
      messages: [{ text: '放到开发目录' }, { text: '不要新建目录，继续尝试' }]
    });
    database.close();
  });

  it('expires only unresolved sessions after seven days and keeps dialogue', async () => {
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
      messages: [{ text: 'private conversation' }]
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
