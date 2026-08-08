import type { MetadataRepository } from '../../storage/types';
import type { ChromeBookmarkApi } from './chrome-types';

export interface BookmarkRefreshEvent {
  bookmarkId: string;
  deferAi: boolean;
}

export interface BookmarkEventSyncDeps {
  api: ChromeBookmarkApi;
  metadata: MetadataRepository;
  onRefresh?: (event: BookmarkRefreshEvent) => void;
  isImporting?: () => boolean;
}

export function registerBookmarkEventSync(deps: BookmarkEventSyncDeps): () => void {
  const refresh = (bookmarkId: string) => deps.onRefresh?.({ bookmarkId, deferAi: deps.isImporting?.() ?? false });
  const onCreated = (id: string) => refresh(id);
  const onChanged = (id: string) => refresh(id);
  const onMoved = (id: string) => refresh(id);
  const onRemoved = (id: string) => {
    void deps.metadata.softDelete(id, Date.now());
    refresh(id);
  };

  deps.api.onCreated.addListener(onCreated);
  deps.api.onChanged.addListener(onChanged);
  deps.api.onMoved.addListener(onMoved);
  deps.api.onRemoved.addListener(onRemoved);

  return () => {
    deps.api.onCreated.removeListener(onCreated);
    deps.api.onChanged.removeListener(onChanged);
    deps.api.onMoved.removeListener(onMoved);
    deps.api.onRemoved.removeListener(onRemoved);
  };
}
