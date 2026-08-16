import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/anthropic-success.json';
import { AnthropicMessagesAdapter } from '../../../src/ai/adapters/anthropic-messages';
import { buildAnalysisProbePrompt } from '../../../src/ai/prompts/analysis-prompt';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = { id: 'p', version: 'v1', name: 'P', protocol: 'anthropic-messages', endpoint: 'https://api.anthropic.com/v1', model: 'claude', apiKey: 'key', timeoutMs: 1000, capabilities: ['classify'], state: 'verified' };

describe('AnthropicMessagesAdapter', () => {
  it('probes the full analysis contract', async () => {
    const prompt = buildAnalysisProbePrompt();
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new AnthropicMessagesAdapter(post).testConnection(profile, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        max_tokens: 256
      })
    }));
    expect(result).toEqual({ authentication: true, text: true, structuredOutput: true, embedding: false });
  });

  it('rejects the obsolete single-field probe response', async () => {
    const post = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"ok":true}' }]
    });

    await expect(
      new AnthropicMessagesAdapter(post).testConnection(
        profile,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('uses Anthropic headers and messages', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new AnthropicMessagesAdapter(post).analyze(profile, { title: 'A', url: 'https://a.test', currentFolderPath: [] }, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'x-api-key': 'key', 'anthropic-version': '2023-06-01' }, body: expect.objectContaining({ system: expect.any(String), messages: expect.any(Array), max_tokens: 1024 }) }));
    expect(result.confidence).toBe('medium');
  });

  it('reviews capture history with the Anthropic message contract', async () => {
    const post = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            memories: [],
            reviewSummary: '暂未发现稳定规律'
          })
        }
      ]
    });

    const result = await new AnthropicMessagesAdapter(
      post
    ).reviewCaptureHistory(
      profile,
      { examples: [] },
      new AbortController().signal
    );

    expect(result.reviewSummary).toBe('暂未发现稳定规律');
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          max_tokens: 1200,
          system: expect.stringContaining('memories'),
          messages: expect.any(Array)
        })
      })
    );
  });
});
