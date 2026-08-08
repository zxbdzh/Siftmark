import type { AiAdapterRegistry } from '../../ai/adapter-registry';
import type { ProfileRepository } from '../../ai/profiles/profile-repository';
import type { SearchDocument } from '../../search/types';
import { EmbeddingIndexer } from '../../search/embedding/embedding-indexer';
import type { TaskHandler } from '../types';

export interface IndexEmbeddingsInput {
  profileId: string;
  profileVersion: string;
  vectorVersion?: string;
  bookmarkIds?: string[];
}

export function createIndexEmbeddingsHandler(dependencies: {
  profiles: ProfileRepository;
  adapters: AiAdapterRegistry;
  indexer: EmbeddingIndexer;
  loadDocuments(bookmarkIds?: string[]): Promise<SearchDocument[]>;
}): TaskHandler<IndexEmbeddingsInput> {
  return async ({ task, signal, reportProgress }) => {
    const profile = await dependencies.profiles.get(task.input.profileId, task.input.profileVersion);
    if (!profile || profile.state !== 'verified' || !profile.capabilities.includes('embed')) return { state: 'failed', failed: task.failed + 1 };
    const adapter = dependencies.adapters.get(profile.protocol);
    if (!adapter?.embed) return { state: 'failed', failed: task.failed + 1 };
    const documents = await dependencies.loadDocuments(task.input.bookmarkIds);
    const result = await dependencies.indexer.index(
      documents,
      { profileId: `${profile.id}@${profile.version}`, vectorVersion: task.input.vectorVersion ?? `${profile.model}@${profile.version}` },
      { embed: (texts, currentSignal) => adapter.embed!(profile, texts, currentSignal) },
      { signal, onProgress: (completed) => reportProgress({ completed, failed: task.failed }) }
    );
    return { state: result.state, completed: result.completed, failed: task.failed };
  };
}
