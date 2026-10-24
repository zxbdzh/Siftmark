import { describe, expect, it } from 'vitest';
import {
  clearOrganizationCheckpoint,
  loadOrganizationCheckpoint,
  saveOrganizationCheckpoint,
  type OrganizationCheckpoint
} from '../../../src/bookmarks/organization-checkpoint';

function memoryStorage() {
  const values = new Map<string, unknown>();
  return {
    async get(key: string) {
      return { [key]: values.get(key) };
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
    async remove(key: string) {
      values.delete(key);
    }
  };
}

const checkpoint: OrganizationCheckpoint = {
  version: 1,
  savedAt: 1,
  profileKey: 'sylorapi\u0000grok',
  concurrency: 4,
  bookmarkIds: ['a', 'b'],
  batches: [
    {
      id: 'reading-1',
      stage: 'reading',
      batch: 1,
      count: 2,
      status: 'completed',
      attempt: 1,
      folders: [{ path: ['开发'], purpose: '资料' }]
    }
  ],
  folders: [{ path: ['开发'], purpose: '资料' }],
  pipelineError: '模型请求超时'
};

describe('organization checkpoint', () => {
  it('keeps completed batches locally and can clear them', async () => {
    const storage = memoryStorage();
    expect(await loadOrganizationCheckpoint(storage)).toBeUndefined();
    await saveOrganizationCheckpoint(storage, checkpoint);
    expect(await loadOrganizationCheckpoint(storage)).toEqual(checkpoint);
    await clearOrganizationCheckpoint(storage);
    expect(await loadOrganizationCheckpoint(storage)).toBeUndefined();
  });

  it('keeps checkpoint writes ordered and clears after the latest save', async () => {
    const values = new Map<string, unknown>();
    const operations: string[] = [];
    let release!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage = {
      async get(key: string) {
        return { [key]: values.get(key) };
      },
      async set(items: Record<string, unknown>) {
        const entry = Object.values(items)[0] as OrganizationCheckpoint;
        operations.push(`save-${entry.savedAt}`);
        if (entry.savedAt === 1) await firstWrite;
        for (const [key, value] of Object.entries(items))
          values.set(key, value);
      },
      async remove(key: string) {
        operations.push('clear');
        values.delete(key);
      }
    };
    const first = saveOrganizationCheckpoint(storage, checkpoint);
    const latest = saveOrganizationCheckpoint(storage, {
      ...checkpoint,
      savedAt: 2
    });
    const clear = clearOrganizationCheckpoint(storage);
    release();
    await Promise.all([first, latest, clear]);
    expect(operations).toEqual(['save-1', 'save-2', 'clear']);
    expect(await loadOrganizationCheckpoint(storage)).toBeUndefined();
  });
});
