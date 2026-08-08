import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import type { BookmarkNode } from '../../src/bookmarks/types';
import { ManagerLayout } from '../../src/ui/manager/ManagerLayout';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { DexieOperationRepository } from '../../src/operations/operation-repository';
import { DexieMetadataRepository } from '../../src/storage/metadata-repository';
import { BookmarkCommandService } from '../../src/operations/bookmark-command-service';
import { ChromeSettingsRepository } from '../../src/settings/settings-repository';
import { hydrateTheme } from '../../src/ui/theme/theme-store';
import { DexieProposalRepository, type AnalysisProposal } from '../../src/ai/proposal';
import { ReviewService } from '../../src/ui/review/review-service';
import { ReviewWorkspace } from '../../src/ui/review/ReviewWorkspace';
import type { BookmarkMetadata } from '../../src/storage/types';
import { ChromeNoteDraftRepository, type NoteDraft } from '../../src/notes/draft-repository';
import { NoteDraftWorkspace } from '../../src/ui/notes/NoteDraftWorkspace';

export default function App() {
  const repository = useMemo(() => new ChromeBookmarkRepository(browser.bookmarks as unknown as ChromeBookmarkApi), []);
  const database = useMemo(() => openSiftmarkDatabase(), []);
  const metadata = useMemo(() => new DexieMetadataRepository(database), [database]);
  const proposalRepository = useMemo(() => new DexieProposalRepository(database), [database]);
  const commands = useMemo(() => new BookmarkCommandService(repository, new DexieOperationRepository(database), metadata), [database, metadata, repository]);
  const reviewService = useMemo(() => new ReviewService(proposalRepository, commands, metadata), [commands, metadata, proposalRepository]);
  const noteDraftRepository = useMemo(() => new ChromeNoteDraftRepository(browser.storage.local), []);
  const settings = useMemo(() => new ChromeSettingsRepository(browser.storage.local), []);
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [recycleBinId, setRecycleBinId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<AnalysisProposal[]>([]);
  const [metadataById, setMetadataById] = useState(new Map<string, BookmarkMetadata>());
  const [visitsById, setVisitsById] = useState(new Map<string, number>());
  const [noteDrafts, setNoteDrafts] = useState<NoteDraft[]>([]);
  const refresh = useCallback(async () => {
    const [nextNodes, metadataRows, visitRows] = await Promise.all([repository.getTree(), database.bookmarkMetadata.toArray(), database.visitAggregates.toArray()]);
    setNodes(nextNodes);
    setMetadataById(new Map(metadataRows.map((row) => [row.bookmarkId, row])));
    setVisitsById(new Map(visitRows.map((row) => [row.bookmarkId, row.lastVisitedAt ?? 0])));
  }, [database, repository]);
  const refreshProposals = useCallback(async () => setProposals(await proposalRepository.list()), [proposalRepository]);
  useEffect(() => { void Promise.all([refresh(), refreshProposals(), noteDraftRepository.list().then(setNoteDrafts), hydrateTheme(settings), settings.getSpecialFolders().then((value) => setRecycleBinId(value.recycleBinId))]).finally(() => setLoading(false)); }, [noteDraftRepository, refresh, refreshProposals, settings]);
  return <ManagerLayout nodes={nodes} loading={loading} repository={repository} commands={commands} metadataRepository={metadata} metadataById={metadataById} visitsById={visitsById} sortRepository={settings} recycleBinId={recycleBinId} onRefresh={refresh} onAnalyze={(bookmark) => void browser.runtime.sendMessage({ type: 'queue-analysis', input: { bookmarkId: bookmark.id } }).then(() => globalThis.setTimeout(() => void refreshProposals(), 300))} reviewWorkspace={<ReviewWorkspace proposals={proposals} onApply={async (id, fields) => { await reviewService.applyProposal({ proposalId: id, fields }); await Promise.all([refresh(), refreshProposals()]); }} onReject={async (id) => { await reviewService.reject(id); await refreshProposals(); }} onRetry={async (proposal) => { await browser.runtime.sendMessage({ type: 'queue-analysis', input: { bookmarkId: proposal.bookmarkId } }); }}/>} draftWorkspace={<NoteDraftWorkspace drafts={noteDrafts} onDelete={(id) => void noteDraftRepository.remove(id).then(() => noteDraftRepository.list().then(setNoteDrafts))}/>} />;
}
