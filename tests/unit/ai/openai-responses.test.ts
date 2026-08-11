import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/openai-responses-success.json';
import { OpenAiResponsesAdapter } from '../../../src/ai/adapters/openai-responses';
import { ProviderError } from '../../../src/ai/network/errors';
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

  it('uses nested output text when the relay returns a blank top-level field', async () => {
    const post = vi.fn().mockResolvedValue({
      output_text: '',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: fixture.output_text }]
        }
      ]
    });

    await expect(
      new OpenAiResponsesAdapter(post).analyze(
        profile,
        { title: 'A', url: 'https://a.test', currentFolderPath: [] },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ title: '示例' });
  });

  it('sends optional web search and vision inputs in Responses format', async () => {
    const post = vi.fn().mockResolvedValue({
      ...fixture,
      output: [{ type: 'web_search_call' }]
    });
    const result = await new OpenAiResponsesAdapter(post).analyze(
      profile,
      {
        title: 'A',
        url: 'https://a.test',
        currentFolderPath: [],
        imageDataUrl: 'data:image/jpeg;base64,AA==',
        webSearch: true
      },
      new AbortController().signal
    );

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          tools: [{ type: 'web_search' }],
          tool_choice: 'required',
          input: [
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'input_text' }),
                {
                  type: 'input_image',
                  image_url: 'data:image/jpeg;base64,AA==',
                  detail: 'low'
                }
              ])
            })
          ]
        })
      })
    );
    expect(result.toolUsage).toEqual({
      vision: true,
      webSearch: 'used'
    });
  });

  it('falls back to text analysis when a compatible relay rejects enhancements', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError('validation', 'unsupported tools', 400)
      )
      .mockResolvedValueOnce(fixture);

    const result = await new OpenAiResponsesAdapter(post).analyze(
      profile,
      {
        title: 'A',
        url: 'https://a.test',
        currentFolderPath: [],
        imageDataUrl: 'data:image/jpeg;base64,AA==',
        webSearch: true
      },
      new AbortController().signal
    );

    expect(post).toHaveBeenCalledTimes(2);
    const fallbackBody = post.mock.calls[1]![0].body as Record<string, unknown>;
    expect(fallbackBody.tools).toBeUndefined();
    expect(fallbackBody.input).toEqual(expect.any(String));
    expect(result.toolUsage).toEqual({
      vision: false,
      webSearch: 'not-used'
    });
  });

  it('falls back when an enhanced Responses request returns no text', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ output: [{ type: 'web_search_call' }] })
      .mockResolvedValueOnce(fixture);

    const result = await new OpenAiResponsesAdapter(post).analyze(
      profile,
      {
        title: 'A',
        url: 'https://a.test',
        currentFolderPath: [],
        webSearch: true
      },
      new AbortController().signal
    );

    expect(result).toMatchObject({
      title: '示例',
      toolUsage: { webSearch: 'not-used' }
    });
    expect(post).toHaveBeenCalledTimes(2);
    const fallbackBody = post.mock.calls[1]![0].body as Record<string, unknown>;
    expect(fallbackBody.tools).toBeUndefined();
    expect(fallbackBody.input).toEqual(expect.any(String));
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
