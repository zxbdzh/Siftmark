import { describe, expect, it, vi } from 'vitest';
import { AiAdapterRegistry } from '../../../src/ai/adapter-registry';
import { AnalysisCoordinator } from '../../../src/ai/analysis-coordinator';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';
import type { ModelProfile } from '../../../src/ai/types';
import type { ProposalRepository } from '../../../src/ai/proposal';

const snapshot = { id: 'b1', parentId: '0', index: 0, title: 'A', url: 'https://a.test' };
const profile: ModelProfile = { id: 'p', version: 'v1', name: 'P', protocol: 'openai-chat', endpoint: 'https://api.test', model: 'm', apiKey: 'key', timeoutMs: 1000, capabilities: ['classify'], state: 'verified' };

describe('AnalysisCoordinator', () => {
  it('emits a model proposal without mutating bookmarks', async () => {
    const bookmarks = { get: vi.fn().mockResolvedValue(snapshot), move: vi.fn(), update: vi.fn() } as unknown as BookmarkRepository;
    const proposals = { put: vi.fn() } as unknown as ProposalRepository;
    const adapters = new AiAdapterRegistry();
    adapters.register({ protocol: 'openai-chat', testConnection: vi.fn(), analyze: vi.fn().mockResolvedValue({ folderPath: ['技术'], title: 'A', tags: [], summary: '摘要', confidence: 'low', reason: '复核' }) });
    const result = await new AnalysisCoordinator({ bookmarks, profiles: [profile], adapters, proposals, createId: () => 'proposal' }).analyze(snapshot, { title: 'A', url: snapshot.url, currentFolderPath: [] });
    expect(result).toMatchObject({ id: 'proposal', state: 'pending' });
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('marks a changed source as conflict', async () => {
    const proposals = { put: vi.fn() } as unknown as ProposalRepository;
    const result = await new AnalysisCoordinator({ bookmarks: { get: vi.fn().mockResolvedValue({ ...snapshot, title: 'Changed' }) } as unknown as BookmarkRepository, profiles: [], adapters: new AiAdapterRegistry(), proposals, createId: () => 'conflict' }).analyze(snapshot, { title: 'A', url: snapshot.url, currentFolderPath: [] });
    expect(result.state).toBe('conflict');
  });
});
