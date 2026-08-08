import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { registerBookmarkEventSync } from '../../src/platform/chrome/bookmark-events';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import type { MetadataRepository } from '../../src/storage/types';

function event() {
  return { addListener: vi.fn(), removeListener: vi.fn() };
}

describe('bookmark event sync', () => {
  it('soft deletes removed metadata and unsubscribes all listeners', async () => {
    const api = { onCreated: event(), onChanged: event(), onMoved: event(), onRemoved: event() } as unknown as ChromeBookmarkApi;
    const metadata = { softDelete: vi.fn().mockResolvedValue(undefined) } as unknown as MetadataRepository;
    const onRefresh = vi.fn();
    const unsubscribe = registerBookmarkEventSync({ api, metadata, onRefresh });
    const removed = (api.onRemoved.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (id: string) => void;
    removed('b1');
    expect(metadata.softDelete).toHaveBeenCalledWith('b1', expect.any(Number));
    expect(onRefresh).toHaveBeenCalledWith({ bookmarkId: 'b1', deferAi: false });
    unsubscribe();
    expect(api.onCreated.removeListener).toHaveBeenCalledTimes(1);
    expect(api.onRemoved.removeListener).toHaveBeenCalledTimes(1);
  });
});
