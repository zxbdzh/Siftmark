import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/anthropic-success.json';
import { AnthropicMessagesAdapter } from '../../../src/ai/adapters/anthropic-messages';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = { id: 'p', version: 'v1', name: 'P', protocol: 'anthropic-messages', endpoint: 'https://api.anthropic.com/v1', model: 'claude', apiKey: 'key', timeoutMs: 1000, capabilities: ['classify'], state: 'verified' };

describe('AnthropicMessagesAdapter', () => {
  it('uses Anthropic headers and messages', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new AnthropicMessagesAdapter(post).analyze(profile, { title: 'A', url: 'https://a.test', currentFolderPath: [] }, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'x-api-key': 'key', 'anthropic-version': '2023-06-01' }, body: expect.objectContaining({ system: expect.any(String), messages: expect.any(Array), max_tokens: 1024 }) }));
    expect(result.confidence).toBe('medium');
  });
});
