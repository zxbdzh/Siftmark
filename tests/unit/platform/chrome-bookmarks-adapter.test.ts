import { describe, expect, it, vi } from 'vitest';
import { ChromeBookmarkRepository } from '../../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../../src/platform/chrome/chrome-types';

function api(overrides: Partial<ChromeBookmarkApi> = {}): ChromeBookmarkApi {
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  return {
    get: vi.fn(), getTree: vi.fn(), create: vi.fn(), update: vi.fn(), move: vi.fn(), remove: vi.fn(),
    onCreated: event(), onChanged: event(), onMoved: event(), onRemoved: event(), ...overrides
  } as ChromeBookmarkApi;
}

describe('ChromeBookmarkRepository', () => {
  it('maps a Chrome folder without inventing a URL', async () => {
    const chromeApi = api({ get: vi.fn().mockResolvedValue([{ id: '10', parentId: '1', index: 0, title: 'Folder' }]) });
    const repository = new ChromeBookmarkRepository(chromeApi);
    expect(await repository.get('10')).toEqual({ id: '10', parentId: '1', index: 0, title: 'Folder', dateAdded: undefined });
  });

  it('flattens a tree and preserves nested order', async () => {
    const chromeApi = api({ getTree: vi.fn().mockResolvedValue([{ id: '0', title: '', children: [{ id: '1', parentId: '0', index: 0, title: 'A', url: 'https://a.test' }] }]) });
    const repository = new ChromeBookmarkRepository(chromeApi);
    expect(await repository.getTree()).toHaveLength(2);
  });

  it('supports callback-style Chrome APIs', async () => {
    const chromeApi = api({ get: vi.fn((_id, callback) => callback?.([{ id: '1', parentId: '0', index: 0, title: 'A' }])) });
    expect(await new ChromeBookmarkRepository(chromeApi).get('1')).toMatchObject({ id: '1', title: 'A' });
  });

  it('returns the single bookmark node produced by the Chrome move API', async () => {
    const chromeApi = api({
      move: vi.fn().mockResolvedValue({
        id: '1',
        parentId: '2',
        index: 0,
        title: 'Moved',
        url: 'https://moved.test/'
      }) as never
    });

    await expect(
      new ChromeBookmarkRepository(chromeApi).move('1', '2', 0)
    ).resolves.toMatchObject({ id: '1', parentId: '2', title: 'Moved' });
  });
});
