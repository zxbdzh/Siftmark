import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/openai-responses-success.json';
import { OpenAiResponsesAdapter } from '../../../src/ai/adapters/openai-responses';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = { id: 'p', version: 'v1', name: 'P', protocol: 'openai-responses', endpoint: 'https://api.test/v1', model: 'm', apiKey: 'key', timeoutMs: 1000, capabilities: ['classify'], state: 'verified' };

describe('OpenAiResponsesAdapter', () => {
  it('probes the Responses structured text format', async () => {
    const post = vi.fn().mockResolvedValue({ output_text: '{"ok":true}' });
    const result = await new OpenAiResponsesAdapter(post).testConnection(profile, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ text: { format: expect.objectContaining({ type: 'json_schema', strict: true }) } }) }));
    expect(result.structuredOutput).toBe(true);
    expect(result.embedding).toBe(false);
  });

  it('uses Responses input and structured text format', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new OpenAiResponsesAdapter(post).analyze(profile, { title: 'A', url: 'https://a.test', currentFolderPath: [] }, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.test/v1/responses', body: expect.objectContaining({ input: expect.any(String), text: { format: expect.objectContaining({ type: 'json_schema' }) } }) }));
    expect(result.title).toBe('示例');
  });
});
