import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/openai-chat-success.json';
import { OpenAiChatAdapter } from '../../../src/ai/adapters/openai-chat';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = { id: 'p', version: 'v1', name: 'P', protocol: 'openai-chat', endpoint: 'https://api.test/v1/', model: 'm', apiKey: 'key', timeoutMs: 1000, capabilities: ['classify'], state: 'verified' };

describe('OpenAiChatAdapter', () => {
  it('uses chat messages and parses the common result', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new OpenAiChatAdapter(post).analyze(profile, { title: 'A', url: 'https://a.test', currentFolderPath: [] }, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.test/v1/chat/completions', headers: { authorization: 'Bearer key' }, body: expect.objectContaining({ messages: expect.any(Array) }) }));
    expect(result.confidence).toBe('high');
  });
});
