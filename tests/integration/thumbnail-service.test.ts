import { describe, expect, it, vi } from 'vitest';
import { enforceThumbnailBudget, ThumbnailService } from '../../src/capture/thumbnail-service';
import type { ThumbnailRepository } from '../../src/storage/thumbnail-repository';
import type { ThumbnailRecord } from '../../src/storage/schema';

function memoryRepository(initial: ThumbnailRecord[] = []): ThumbnailRepository & { rows: Map<string, ThumbnailRecord> } {
  const rows = new Map(initial.map((row) => [row.bookmarkId, row]));
  return { rows, get: vi.fn(async (id) => rows.get(id) ?? null), findByHash: vi.fn(async (hash) => [...rows.values()].find((row) => row.hash === hash) ?? null), list: vi.fn(async () => [...rows.values()]), put: vi.fn(async (row) => { rows.set(row.bookmarkId, row); }), delete: vi.fn(async (id) => { rows.delete(id); }) };
}

describe('ThumbnailService', () => {
  it('deduplicates blobs by hash and does not capture a changed tab', async () => {
    const shared = new Blob(['same'], { type: 'image/webp' });
    const repository = memoryRepository([{ bookmarkId: 'old', blob: shared, hash: 'hash', width: 10, height: 10, state: 'ready', createdAt: 1, lastAccessedAt: 1 }]);
    const api = { captureVisibleTab: vi.fn().mockResolvedValue('data:image/png;base64,AA==') };
    const process = vi.fn().mockResolvedValue({ blob: new Blob(['new']), hash: 'hash', width: 10, height: 10 });
    const service = new ThumbnailService(api, repository as never, process, () => 2);
    const result = await service.captureCurrentTab({ bookmarkId: 'new', tabId: 2, activeTabId: 2, screenshotAllowed: true });
    expect(result.blob).toBe(shared);
    const changed = await service.captureCurrentTab({ bookmarkId: 'changed', tabId: 2, activeTabId: 3, screenshotAllowed: true });
    expect(changed).toMatchObject({ state: 'failed', errorKind: 'tab-changed' });
    expect(api.captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('evicts least recently used blobs above the configured budget', async () => {
    const repository = memoryRepository([{ bookmarkId: 'old', blob: new Blob(['12345']), state: 'ready', createdAt: 1, lastAccessedAt: 1 }, { bookmarkId: 'new', blob: new Blob(['12345']), state: 'ready', createdAt: 2, lastAccessedAt: 2 }]);
    expect(await enforceThumbnailBudget(repository as never, 6)).toEqual(['old']);
  });
});
