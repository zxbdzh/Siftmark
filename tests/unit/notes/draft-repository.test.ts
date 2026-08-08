import { describe, expect, it } from 'vitest';
import { ChromeNoteDraftRepository } from '../../../src/notes/draft-repository';

describe('ChromeNoteDraftRepository', () => {
  it('caps selected text locally and lists newest drafts first', async () => {
    const values: Record<string, unknown> = {};
    const repository = new ChromeNoteDraftRepository({ get: async () => values, set: async (items) => { Object.assign(values, items); }, remove: async (key) => { delete values[key]; } });
    await repository.put({ id: 'old', text: '旧', title: '旧页面', url: 'https://old.test', createdAt: 1, truncated: false });
    await repository.put({ id: 'new', text: '新'.repeat(2_100), title: '新页面', url: 'https://new.test', createdAt: 2, truncated: false });
    const drafts = await repository.list();
    expect(drafts.map((draft) => draft.id)).toEqual(['new', 'old']);
    expect(drafts[0]).toMatchObject({ truncated: true });
    expect(drafts[0]!.text).toHaveLength(2_000);
  });
});
