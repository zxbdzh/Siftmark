import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/openai-chat-success.json';
import { OpenAiChatAdapter } from '../../../src/ai/adapters/openai-chat';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = { id: 'p', version: 'v1', name: 'P', protocol: 'openai-chat', endpoint: 'https://api.test/v1/', model: 'm', apiKey: 'key', timeoutMs: 1000, capabilities: ['classify'], state: 'verified' };

describe('OpenAiChatAdapter', () => {
  it('verifies structured output and embeddings when both are requested', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"ok":true}' } }] })
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [1, 0] }] });
    const result = await new OpenAiChatAdapter(post).testConnection({ ...profile, capabilities: ['classify', 'embed'] }, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ response_format: { type: 'json_schema', json_schema: expect.objectContaining({ strict: true }) } }) }));
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://api.test/v1/embeddings', body: { model: 'm', input: ['siftmark'], encoding_format: 'float' } }));
    expect(result).toEqual({ authentication: true, text: true, structuredOutput: true, embedding: true });
  });

  it('rejects a probe response that does not match the schema', async () => {
    const post = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"ok":false}' } }] });
    await expect(new OpenAiChatAdapter(post).testConnection(profile, new AbortController().signal)).rejects.toMatchObject({ kind: 'validation' });
  });

  it('uses chat messages and parses the common result', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new OpenAiChatAdapter(post).analyze(profile, { title: 'A', url: 'https://a.test', currentFolderPath: [] }, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.test/v1/chat/completions', headers: { authorization: 'Bearer key' }, body: expect.objectContaining({ messages: expect.any(Array) }) }));
    expect(result.confidence).toBe('high');
  });
});
