import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/openai-responses-success.json';
import { OpenAiResponsesAdapter } from '../../../src/ai/adapters/openai-responses';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = {
  id: 'p',
  version: 'v1',
  name: 'P',
  protocol: 'openai-responses',
  endpoint: 'https://api.test/v1',
  model: 'm',
  apiKey: 'key',
  timeoutMs: 1000,
  capabilities: ['classify'],
  state: 'verified'
};

describe('OpenAiResponsesAdapter', () => {
  it('probes the Responses structured text format', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new OpenAiResponsesAdapter(post).testConnection(
      profile,
      new AbortController().signal
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          input: expect.stringContaining('siftmark_analysis_probe'),
          max_output_tokens: 256,
          text: {
            format: expect.objectContaining({
              type: 'json_schema',
              strict: true,
              schema: expect.objectContaining({
                required: [
                  'folderPath',
                  'title',
                  'tags',
                  'summary',
                  'confidence',
                  'reason'
                ]
              })
            })
          }
        })
      })
    );
    expect(result.structuredOutput).toBe(true);
    expect(result.embedding).toBe(false);
  });

  it('uses Responses input and structured text format', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new OpenAiResponsesAdapter(post).analyze(
      profile,
      { title: 'A', url: 'https://a.test', currentFolderPath: [] },
      new AbortController().signal
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.test/v1/responses',
        body: expect.objectContaining({
          input: expect.any(String),
          text: { format: expect.objectContaining({ type: 'json_schema' }) }
        })
      })
    );
    expect(result.title).toBe('示例');
  });

  it('keeps working when a compatible provider ignores text.format', async () => {
    const post = async <T>(request: { body: unknown }): Promise<T> => {
      const body = request.body as { instructions?: string; input?: string };
      const visiblePrompt = `${body.instructions ?? ''}\n${body.input ?? ''}`;
      const hasContract = [
        'folderPath',
        'title',
        'tags',
        'summary',
        'confidence',
        'reason'
      ].every((field) => visiblePrompt.includes(`"${field}"`));
      return (
        hasContract ? fixture : { output_text: '{"folderPath":["技术"]}' }
      ) as T;
    };
    await expect(
      new OpenAiResponsesAdapter(post).analyze(
        profile,
        { title: 'A', url: 'https://a.test', currentFolderPath: [] },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ title: '示例' });
  });
});
