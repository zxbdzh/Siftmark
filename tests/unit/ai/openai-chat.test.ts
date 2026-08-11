import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/openai-chat-success.json';
import { OpenAiChatAdapter } from '../../../src/ai/adapters/openai-chat';
import { ProviderError } from '../../../src/ai/network/errors';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = {
  id: 'p',
  version: 'v1',
  name: 'P',
  protocol: 'openai-chat',
  endpoint: 'https://api.test/v1/',
  model: 'm',
  apiKey: 'key',
  timeoutMs: 1000,
  capabilities: ['classify'],
  state: 'verified'
};

describe('OpenAiChatAdapter', () => {
  it('verifies structured output and embeddings when both are requested', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(fixture)
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [1, 0] }] });
    const result = await new OpenAiChatAdapter(post).testConnection(
      { ...profile, capabilities: ['classify', 'embed'] },
      new AbortController().signal
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('siftmark_analysis_probe')
            })
          ]),
          max_tokens: 256,
          response_format: {
            type: 'json_schema',
            json_schema: expect.objectContaining({
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
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: 'https://api.test/v1/embeddings',
        body: { model: 'm', input: ['siftmark'], encoding_format: 'float' }
      })
    );
    expect(result).toEqual({
      authentication: true,
      text: true,
      structuredOutput: true,
      embedding: true
    });
  });

  it('rejects a probe response that does not match the schema', async () => {
    const post = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":false}' } }]
    });
    await expect(
      new OpenAiChatAdapter(post).testConnection(
        profile,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('uses chat messages and parses the common result', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new OpenAiChatAdapter(post).analyze(
      profile,
      { title: 'A', url: 'https://a.test', currentFolderPath: [] },
      new AbortController().signal
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.test/v1/chat/completions',
        headers: { authorization: 'Bearer key' },
        body: expect.objectContaining({ messages: expect.any(Array) })
      })
    );
    expect(result.confidence).toBe('high');
  });

  it('sends optional web search and vision inputs in Chat format', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new OpenAiChatAdapter(post).analyze(
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
          web_search_options: { search_context_size: 'low' },
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'text' }),
                {
                  type: 'image_url',
                  image_url: {
                    url: 'data:image/jpeg;base64,AA==',
                    detail: 'low'
                  }
                }
              ])
            })
          ])
        })
      })
    );
    expect(result.toolUsage).toEqual({
      vision: true,
      webSearch: 'requested'
    });
  });

  it('falls back to text analysis when Chat enhancements are rejected', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError('validation', 'unsupported input', 422)
      )
      .mockResolvedValueOnce(fixture);
    const result = await new OpenAiChatAdapter(post).analyze(
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

    const fallbackBody = post.mock.calls[1]![0].body as {
      messages: Array<{ role: string; content: unknown }>;
      web_search_options?: unknown;
    };
    expect(fallbackBody.web_search_options).toBeUndefined();
    expect(fallbackBody.messages.at(-1)?.content).toEqual(expect.any(String));
    expect(result.toolUsage).toEqual({
      vision: false,
      webSearch: 'not-used'
    });
  });

  it('falls back when an enhanced Chat request returns no text', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })
      .mockResolvedValueOnce(fixture);

    const result = await new OpenAiChatAdapter(post).analyze(
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
    expect(fallbackBody.web_search_options).toBeUndefined();
  });

  it('keeps working when a compatible provider ignores response_format', async () => {
    const post = async <T>(request: { body: unknown }): Promise<T> => {
      const body = request.body as { messages?: Array<{ content?: string }> };
      const visiblePrompt = (body.messages ?? [])
        .map((message) => message.content ?? '')
        .join('\n');
      const hasContract = [
        'folderPath',
        'title',
        'tags',
        'summary',
        'confidence',
        'reason'
      ].every((field) => visiblePrompt.includes(`"${field}"`));
      return (
        hasContract
          ? fixture
          : { choices: [{ message: { content: '{"folderPath":["技术"]}' } }] }
      ) as T;
    };
    await expect(
      new OpenAiChatAdapter(post).analyze(
        profile,
        { title: 'A', url: 'https://a.test', currentFolderPath: [] },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ title: '示例' });
  });

  it('reports missing analysis fields without echoing provider content', async () => {
    const post = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"folderPath":["私密目录"]}' } }]
    });
    await expect(
      new OpenAiChatAdapter(post).analyze(
        profile,
        { title: 'A', url: 'https://a.test', currentFolderPath: [] },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining(
        '缺少必填字段：title、tags、summary、confidence、reason'
      )
    });
    await expect(
      new OpenAiChatAdapter(post).analyze(
        profile,
        { title: 'A', url: 'https://a.test', currentFolderPath: [] },
        new AbortController().signal
      )
    ).rejects.not.toThrow('私密目录');
  });
});
