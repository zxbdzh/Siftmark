import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DexieCapturePreferenceRepository,
  isFixedRuleInstruction,
  preferenceFromDecision,
  type CapturePreference,
  type CaptureSession
} from '../../../src/capture-agent';
import { openSiftmarkDatabase } from '../../../src/storage/database';

const databaseNames: string[] = [];

describe('capture preferences', () => {
  afterEach(async () => {
    await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
  });

  it('returns matching fixed rules before soft preferences', async () => {
    const { database, repository } = createRepository();
    await repository.put(preference({ id: 'soft', updatedAt: 5 }));
    await repository.put(
      preference({ id: 'rule', kind: 'fixed-rule', updatedAt: 1 })
    );
    await repository.put(
      preference({ id: 'other', domain: 'other.test', updatedAt: 10 })
    );

    await expect(
      repository.listMatching('https://example.test/docs/agent', 'Agent docs')
    ).resolves.toMatchObject([{ id: 'rule' }, { id: 'soft' }]);
    database.close();
  });

  it('turns ordinary approval into a soft local signal', () => {
    expect(
      preferenceFromDecision({
        id: 'preference',
        session: captureSession(),
        decision: 'allow',
        createdAt: 10
      })
    ).toMatchObject({
      kind: 'soft',
      domain: 'example.test',
      action: 'prefer-folder',
      destinationFolderId: 'agent',
      destinationPath: ['开发', 'AI', 'Agent'],
      source: 'allow'
    });
  });

  it('creates a visible fixed rule only for explicit future intent', () => {
    expect(isFixedRuleInstruction('以后这类都放到 Agent 目录')).toBe(true);
    expect(isFixedRuleInstruction('这次放到 Agent 目录')).toBe(false);
    expect(
      preferenceFromDecision({
        id: 'rule',
        session: captureSession(),
        decision: 'agent-adjustment',
        explicitRule: true,
        createdAt: 10
      })
    ).toMatchObject({ kind: 'fixed-rule', source: 'explicit-rule' });
  });
});

function createRepository() {
  const name = `siftmark-capture-preferences-${crypto.randomUUID()}`;
  databaseNames.push(name);
  const database = openSiftmarkDatabase(name);
  return {
    database,
    repository: new DexieCapturePreferenceRepository(database)
  };
}

function preference(
  patch: Partial<CapturePreference> = {}
): CapturePreference {
  return {
    id: 'preference',
    kind: 'soft',
    domain: 'example.test',
    action: 'prefer-folder',
    destinationFolderId: 'agent',
    destinationPath: ['开发', 'AI', 'Agent'],
    source: 'allow',
    sourceSessionId: 'session',
    createdAt: 1,
    updatedAt: 1,
    ...patch
  };
}

function captureSession(): CaptureSession {
  return {
    id: 'session',
    bookmarkId: 'bookmark',
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: 'bookmark',
      parentId: 'inbox',
      index: 0,
      title: 'Agent docs',
      url: 'https://example.test/docs/agent?secret=hidden'
    },
    state: 'pending',
    plan: {
      destination: {
        folderId: 'agent',
        path: [
          { id: 'dev', title: '开发' },
          { id: 'ai', title: 'AI' },
          { id: 'agent', title: 'Agent' }
        ],
        newFolders: []
      },
      title: 'Agent docs',
      tags: [],
      summary: '',
      confidence: 'high',
      reason: 'related folder',
      relatedBookmarks: [],
      generatedAt: 1
    },
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 2
  };
}
