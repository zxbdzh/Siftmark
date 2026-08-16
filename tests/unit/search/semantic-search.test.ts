import { describe, expect, it, vi } from 'vitest';
import type { AiAdapter } from '../../../src/ai/adapters/adapter';
import type { ModelProfile } from '../../../src/ai/types';
import { EmbeddingSemanticSearch } from '../../../src/search/embedding/semantic-search';
import type { VectorSearch } from '../../../src/search/embedding/vector-search';

const profile: ModelProfile = {
  id: 'embedding',
  version: '1',
  name: 'Embedding',
  protocol: 'openai-chat',
  endpoint: 'https://model.test',
  model: 'embedding-model',
  apiKey: 'secret',
  timeoutMs: 10_000,
  capabilities: ['embed'],
  state: 'verified'
};

describe('EmbeddingSemanticSearch', () => {
  it('redacts the query immediately before the embedding adapter call', async () => {
    const embed = vi.fn().mockResolvedValue([[1, 0]]);
    const adapter = {
      protocol: 'openai-chat',
      testConnection: vi.fn(),
      analyze: vi.fn(),
      embed
    } as unknown as AiAdapter;
    const vectors = {
      query: vi.fn().mockResolvedValue([])
    } as unknown as VectorSearch;
    const search = new EmbeddingSemanticSearch(
      profile,
      adapter,
      vectors,
      () => []
    );

    await search.search({
      text: 'Contact dev@example.test with Bearer abcdefghijklmnop',
      filters: {}
    });

    expect(embed).toHaveBeenCalledWith(
      profile,
      ['Contact [REDACTED_EMAIL] with Bearer [REDACTED_TOKEN]'],
      expect.any(AbortSignal)
    );
  });
});
