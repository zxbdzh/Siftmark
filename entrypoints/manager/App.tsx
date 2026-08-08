import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import type { BookmarkNode } from '../../src/bookmarks/types';
import { ManagerLayout } from '../../src/ui/manager/ManagerLayout';
import { useManagerStore } from '../../src/ui/manager/manager-store';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { DexieOperationRepository } from '../../src/operations/operation-repository';
import { DexieMetadataRepository } from '../../src/storage/metadata-repository';
import { BookmarkCommandService } from '../../src/operations/bookmark-command-service';
import {
  ChromeSettingsRepository,
  type SpecialFolderSettings
} from '../../src/settings/settings-repository';
import { hydrateTheme } from '../../src/ui/theme/theme-store';
import {
  DexieProposalRepository,
  type AnalysisProposal
} from '../../src/ai/proposal';
import { ReviewService } from '../../src/ui/review/review-service';
import { ReviewWorkspace } from '../../src/ui/review/ReviewWorkspace';
import type { BookmarkMetadata } from '../../src/storage/types';
import {
  ChromeNoteDraftRepository,
  type NoteDraft
} from '../../src/notes/draft-repository';
import { NoteDraftWorkspace } from '../../src/ui/notes/NoteDraftWorkspace';
import { DexieThumbnailRepository } from '../../src/storage/thumbnail-repository';
import { LocalSearchIndex } from '../../src/search/local-search-index';
import { SearchIndexRepository } from '../../src/search/search-index-repository';
import { SearchIndexSynchronizer } from '../../src/search/search-index-synchronizer';
import { SearchService } from '../../src/search/search-service';
import { buildSearchDocuments } from '../../src/search/build-search-documents';
import { ChromeProfileRepository } from '../../src/ai/profiles/profile-repository';
import { createDefaultAiAdapterRegistry } from '../../src/ai/create-adapter-registry';
import type { ModelProfile } from '../../src/ai/types';
import { EmbeddingRepository } from '../../src/search/embedding/embedding-repository';
import { VectorSearch } from '../../src/search/embedding/vector-search';
import { EmbeddingSemanticSearch } from '../../src/search/embedding/semantic-search';
import { NotificationRepository } from '../../src/notifications/notification-repository';
import type { AppNotification } from '../../src/notifications/types';
import type { VisitAggregate } from '../../src/storage/schema';
import { NotificationCenter } from '../../src/ui/notifications/NotificationCenter';
import { UsageInsights } from '../../src/ui/manager/UsageInsights';
import { DexieSpecialFolderPlacementRepository } from '../../src/bookmarks/placement-repository';
import { SpecialFolderService } from '../../src/bookmarks/special-folders';
import {
  RecycleService,
  type SpecialFolderPlacement
} from '../../src/bookmarks/recycle-service';
import { ArchiveService } from '../../src/bookmarks/archive-service';

export default function App() {
  const repository = useMemo(
    () =>
      new ChromeBookmarkRepository(
        browser.bookmarks as unknown as ChromeBookmarkApi
      ),
    []
  );
  const database = useMemo(() => openSiftmarkDatabase(), []);
  const metadata = useMemo(
    () => new DexieMetadataRepository(database),
    [database]
  );
  const proposalRepository = useMemo(
    () => new DexieProposalRepository(database),
    [database]
  );
  const thumbnails = useMemo(
    () => new DexieThumbnailRepository(database),
    [database]
  );
  const localSearchIndex = useMemo(() => new LocalSearchIndex(), []);
  const searchIndexRepository = useMemo(
    () => new SearchIndexRepository(database),
    [database]
  );
  const searchSynchronizer = useMemo(
    () => new SearchIndexSynchronizer(localSearchIndex, searchIndexRepository),
    [localSearchIndex, searchIndexRepository]
  );
  const embeddingRepository = useMemo(
    () => new EmbeddingRepository(database),
    [database]
  );
  const vectorSearch = useMemo(
    () => new VectorSearch(embeddingRepository),
    [embeddingRepository]
  );
  const notificationRepository = useMemo(
    () => new NotificationRepository(database),
    [database]
  );
  const adapters = useMemo(() => createDefaultAiAdapterRegistry(), []);
  const commands = useMemo(
    () =>
      new BookmarkCommandService(
        repository,
        new DexieOperationRepository(database),
        metadata
      ),
    [database, metadata, repository]
  );
  const reviewService = useMemo(
    () => new ReviewService(proposalRepository, commands, metadata),
    [commands, metadata, proposalRepository]
  );
  const noteDraftRepository = useMemo(
    () => new ChromeNoteDraftRepository(browser.storage.local),
    []
  );
  const settings = useMemo(
    () => new ChromeSettingsRepository(browser.storage.local),
    []
  );
  const placements = useMemo(
    () => new DexieSpecialFolderPlacementRepository(database),
    [database]
  );
  const specialFolders = useMemo(
    () => new SpecialFolderService(repository, settings),
    [repository, settings]
  );
  const recycleService = useMemo(
    () => new RecycleService(repository, commands, specialFolders, placements),
    [commands, placements, repository, specialFolders]
  );
  const archiveService = useMemo(
    () => new ArchiveService(repository, commands, specialFolders, placements),
    [commands, placements, repository, specialFolders]
  );
  const profiles = useMemo(
    () => new ChromeProfileRepository(browser.storage.local),
    []
  );
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [specialFolderSettings, setSpecialFolderSettings] =
    useState<SpecialFolderSettings>({});
  const [specialFolderPlacements, setSpecialFolderPlacements] = useState(
    new Map<string, SpecialFolderPlacement>()
  );
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<AnalysisProposal[]>([]);
  const [metadataById, setMetadataById] = useState(
    new Map<string, BookmarkMetadata>()
  );
  const [visitsById, setVisitsById] = useState(new Map<string, number>());
  const [visitAggregates, setVisitAggregates] = useState<VisitAggregate[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<NoteDraft[]>([]);
  const [embeddingProfile, setEmbeddingProfile] = useState<ModelProfile>();
  const searchDocuments = useMemo(
    () => buildSearchDocuments(nodes, metadataById, visitsById),
    [metadataById, nodes, visitsById]
  );
  const archiveDestination = useMemo(
    () =>
      nodes.find(
        (node) => node.id === specialFolderSettings.archiveId && !node.url
      ),
    [nodes, specialFolderSettings.archiveId]
  );
  const recycleDestination = useMemo(
    () =>
      nodes.find(
        (node) => node.id === specialFolderSettings.recycleBinId && !node.url
      ),
    [nodes, specialFolderSettings.recycleBinId]
  );
  const semanticSearch = useMemo(() => {
    if (!embeddingProfile) return undefined;
    const adapter = adapters.get(embeddingProfile.protocol);
    return adapter?.embed
      ? new EmbeddingSemanticSearch(
          embeddingProfile,
          adapter,
          vectorSearch,
          () => searchDocuments
        )
      : undefined;
  }, [adapters, embeddingProfile, searchDocuments, vectorSearch]);
  const searchService = useMemo(
    () => new SearchService(localSearchIndex, semanticSearch),
    [localSearchIndex, semanticSearch]
  );
  const refresh = useCallback(async () => {
    const [
      nextNodes,
      metadataRows,
      visitRows,
      placementRows,
      nextSpecialFolders
    ] = await Promise.all([
      repository.getTree(),
      database.bookmarkMetadata.toArray(),
      database.visitAggregates.toArray(),
      placements.list(),
      settings.getSpecialFolders()
    ]);
    setNodes(nextNodes);
    setMetadataById(new Map(metadataRows.map((row) => [row.bookmarkId, row])));
    setVisitsById(
      new Map(visitRows.map((row) => [row.bookmarkId, row.lastVisitedAt ?? 0]))
    );
    setVisitAggregates(visitRows);
    setSpecialFolderPlacements(
      new Map(placementRows.map((row) => [row.bookmarkId, row]))
    );
    setSpecialFolderSettings(nextSpecialFolders);
  }, [database, placements, repository, settings]);
  const refreshProposals = useCallback(
    async () => setProposals(await proposalRepository.list()),
    [proposalRepository]
  );
  const refreshNotifications = useCallback(
    async () => setNotifications(await notificationRepository.list()),
    [notificationRepository]
  );
  useEffect(() => {
    void Promise.all([
      refresh(),
      refreshProposals(),
      refreshNotifications(),
      noteDraftRepository.list().then(setNoteDrafts),
      hydrateTheme(settings).then(() =>
        useManagerStore.setState({
          density:
            document.documentElement.dataset.density === 'compact'
              ? 'compact'
              : 'comfortable'
        })
      )
    ]).finally(() => setLoading(false));
  }, [
    noteDraftRepository,
    refresh,
    refreshNotifications,
    refreshProposals,
    settings
  ]);
  useEffect(() => {
    const listener = (message: unknown) => {
      const type = (message as { type?: string }).type;
      if (type === 'notifications-changed')
        void Promise.all([
          refresh(),
          refreshNotifications(),
          refreshProposals()
        ]);
      else if (type === 'visits-changed') void refresh();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [refresh, refreshNotifications, refreshProposals]);
  useEffect(() => {
    void settings.getProfileAssignments().then(async (assignments) => {
      const key = assignments.embed;
      if (!key) return;
      const separator = key.lastIndexOf('@');
      if (separator <= 0) return;
      const profile = await profiles.get(
        key.slice(0, separator),
        key.slice(separator + 1)
      );
      if (
        profile?.state === 'verified' &&
        profile.capabilities.includes('embed')
      )
        setEmbeddingProfile(profile);
    });
  }, [profiles, settings]);
  useEffect(() => {
    if (!loading)
      void searchSynchronizer
        .sync(searchDocuments)
        .catch((error: unknown) => console.error('搜索索引同步失败', error));
  }, [loading, searchDocuments, searchSynchronizer]);
  return (
    <ManagerLayout
      nodes={nodes}
      loading={loading}
      repository={repository}
      commands={commands}
      metadataRepository={metadata}
      metadataById={metadataById}
      visitsById={visitsById}
      thumbnailRepository={thumbnails}
      searchService={searchService}
      onRefreshThumbnail={(bookmark) =>
        void browser.runtime.sendMessage({
          type: 'queue-thumbnail',
          input: { bookmarkId: bookmark.id }
        })
      }
      sortRepository={settings}
      archiveService={archiveService}
      recycleService={recycleService}
      archiveDestination={archiveDestination}
      recycleDestination={recycleDestination}
      specialFolderPlacements={specialFolderPlacements}
      onRefresh={refresh}
      onAnalyze={(bookmark) =>
        void browser.runtime
          .sendMessage({
            type: 'queue-analysis',
            input: { bookmarkId: bookmark.id }
          })
          .then(() => globalThis.setTimeout(() => void refreshProposals(), 300))
      }
      onHealthScan={(folder) =>
        void browser.runtime.sendMessage({
          type: 'queue-health-scan',
          input: { folderId: folder.id }
        })
      }
      reviewWorkspace={
        <ReviewWorkspace
          proposals={proposals}
          onApply={async (id, fields) => {
            await reviewService.applyProposal({ proposalId: id, fields });
            await Promise.all([refresh(), refreshProposals()]);
          }}
          onReject={async (id) => {
            await reviewService.reject(id);
            await refreshProposals();
          }}
          onRetry={async (proposal) => {
            await browser.runtime.sendMessage({
              type: 'queue-analysis',
              input: { bookmarkId: proposal.bookmarkId }
            });
          }}
        />
      }
      notificationCenter={
        <NotificationCenter
          notifications={notifications}
          onMarkRead={async (id) => {
            await notificationRepository.markRead(id);
            await refreshNotifications();
          }}
          onClear={async () => {
            await notificationRepository.clear();
            await refreshNotifications();
          }}
        />
      }
      usageInsights={
        <UsageInsights nodes={nodes} aggregates={visitAggregates} />
      }
      draftWorkspace={
        <NoteDraftWorkspace
          drafts={noteDrafts}
          onDelete={(id) =>
            void noteDraftRepository
              .remove(id)
              .then(() => noteDraftRepository.list().then(setNoteDrafts))
          }
        />
      }
    />
  );
}
