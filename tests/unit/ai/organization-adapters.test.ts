import { describe, expect, it, vi } from 'vitest';
import { AnthropicMessagesAdapter } from '../../../src/ai/adapters/anthropic-messages';
import { GeminiGenerateContentAdapter } from '../../../src/ai/adapters/gemini-generate-content';
import { OpenAiChatAdapter } from '../../../src/ai/adapters/openai-chat';
import { OpenAiResponsesAdapter } from '../../../src/ai/adapters/openai-responses';
import { MeteredAiAdapter } from '../../../src/ai/adapters/metered-adapter';
import { ProfileLimitedAiAdapter } from '../../../src/ai/adapters/profile-limited-adapter';
import { ProviderError } from '../../../src/ai/network/errors';
import { ProfileLimiter } from '../../../src/ai/network/profile-limiter';
import type { AiOrganizationContext } from '../../../src/ai/organization-types';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = {
  id: 'p',
  version: '1',
  name: 'Model',
  protocol: 'openai-chat',
  endpoint: 'https://api.test/v1',
  model: 'model',
  apiKey: '',
  timeoutMs: 1000,
  capabilities: ['classify'],
  state: 'verified'
};
const context: AiOrganizationContext = {
  mode: 'taxonomy',
  bookmarks: [
    {
      id: '1',
      title: 'MDN',
      url: 'https://mdn.test/',
      currentFolderPath: ['错误旧目录']
    }
  ]
};
const result = {
  folders: [{ path: ['开发', '参考文档'], purpose: '参考资料' }],
  assignments: []
};
const text = JSON.stringify(result);
const signal = new AbortController().signal;

const cases = [
  {
    label: 'OpenAI Chat',
    Adapter: OpenAiChatAdapter,
    protocol: 'openai-chat' as const,
    response: {
      choices: [{ message: { content: text } }],
      usage: { total_tokens: 7 }
    },
    path: '/chat/completions'
  },
  {
    label: 'OpenAI Responses',
    Adapter: OpenAiResponsesAdapter,
    protocol: 'openai-responses' as const,
    response: { output_text: text, usage: { total_tokens: 7 } },
    path: '/responses'
  },
  {
    label: 'Anthropic',
    Adapter: AnthropicMessagesAdapter,
    protocol: 'anthropic-messages' as const,
    response: {
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 4 }
    },
    path: '/messages'
  },
  {
    label: 'Gemini',
    Adapter: GeminiGenerateContentAdapter,
    protocol: 'gemini-generate-content' as const,
    response: {
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { totalTokenCount: 7 }
    },
    path: ':generateContent'
  }
];

describe('organization model protocols', () => {
  it.each(cases)(
    'uses the existing transport, parses strictly, and reports usage for $label',
    async ({ Adapter, protocol, response, path }) => {
      const post = vi.fn().mockResolvedValue(response);
      const adapter = new Adapter(post);
      expect(
        await adapter.planOrganization(
          { ...profile, protocol },
          context,
          signal
        )
      ).toEqual({ ...result, usageTokens: 7 });
      const request = post.mock.calls[0]![0];
      expect(request.url).toContain(path);
      expect(request.signal).toBe(signal);
      expect(request.timeoutMs).toBe(1000);
      expect(JSON.stringify(request.body)).not.toContain('错误旧目录');
    }
  );

  it.each(cases)(
    'fills omitted empty assignments only when planning with $label',
    async ({ Adapter, protocol, response }) => {
      const partialText = JSON.stringify({ folders: result.folders });
      const partialResponse =
        protocol === 'openai-chat'
          ? { ...response, choices: [{ message: { content: partialText } }] }
          : protocol === 'openai-responses'
            ? { ...response, output_text: partialText }
            : protocol === 'anthropic-messages'
              ? { ...response, content: [{ type: 'text', text: partialText }] }
              : {
                  ...response,
                  candidates: [
                    {
                      content: { parts: [{ text: partialText }] },
                      finishReason: 'STOP'
                    }
                  ]
                };
      const adapter = new Adapter(vi.fn().mockResolvedValue(partialResponse));
      for (const mode of ['taxonomy', 'merge-taxonomy'] as const) {
        expect(
          await adapter.planOrganization(
            { ...profile, protocol },
            { ...context, mode },
            signal
          )
        ).toEqual({ ...result, usageTokens: 7 });
      }
      await expect(
        adapter.planOrganization(
          { ...profile, protocol },
          { ...context, mode: 'assign' },
          signal
        )
      ).rejects.toThrow('结构');
    }
  );

  it('preserves JSON schema fallback without treating invalid model output as executable', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError('validation', 'unsupported', 400)
      )
      .mockResolvedValue({ choices: [{ message: { content: text } }] });
    const adapter = new OpenAiChatAdapter(post);
    await adapter.planOrganization(profile, context, signal);
    expect(post.mock.calls[0]![0].body.response_format.type).toBe(
      'json_schema'
    );
    expect(post.mock.calls[1]![0].body.response_format.type).toBe(
      'json_object'
    );
    post.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ ...result, unknown: true }) } }
      ]
    });
    await expect(
      adapter.planOrganization(profile, context, signal)
    ).rejects.toThrow('结构');
  });

  it('carries planning through metering and profile limiting', async () => {
    const post = vi.fn().mockResolvedValue(cases[0]!.response);
    const add = vi.fn().mockResolvedValue(undefined);
    const adapter = new ProfileLimitedAiAdapter(
      new MeteredAiAdapter(new OpenAiChatAdapter(post), { add }),
      new ProfileLimiter(2)
    );
    await adapter.planOrganization!(profile, context, signal);
    expect(post).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'organize-taxonomy',
        tokens: 7,
        status: 'success'
      })
    );
  });

  it('rejects truncated Anthropic results even when partial JSON happens to parse', async () => {
    const adapter = new AnthropicMessagesAdapter(
      vi
        .fn()
        .mockResolvedValue({ ...cases[2]!.response, stop_reason: 'max_tokens' })
    );
    await expect(
      adapter.planOrganization(
        { ...profile, protocol: 'anthropic-messages' },
        context,
        signal
      )
    ).rejects.toThrow('截断');
  });
  it.each([
    { endpoint: 'https://api.deepseek.com/v1', thinking: { type: 'disabled' } },
    { endpoint: 'https://gateway.test/v1', thinking: undefined },
    {
      endpoint: 'https://api.deepseek.com.gateway.test/v1',
      thinking: undefined
    }
  ])(
    'uses DeepSeek non-thinking planning only for its official endpoint: $endpoint',
    async ({ endpoint, thinking }) => {
      const post = vi.fn().mockResolvedValue(cases[0]!.response);
      const adapter = new OpenAiChatAdapter(post);
      await adapter.planOrganization(
        {
          ...profile,
          endpoint,
          model: 'deepseek-flash',
          structuredOutput: 'json_object'
        },
        context,
        signal
      );
      expect(post.mock.calls[0]![0].body.thinking).toEqual(thinking);
    }
  );

  it.each([text, ''])(
    'rejects a Chat length result even if its content can parse',
    async (content) => {
      const post = vi.fn().mockResolvedValue({
        choices: [{ message: { content }, finish_reason: 'length' }]
      });
      const adapter = new OpenAiChatAdapter(post);
      await expect(
        adapter.planOrganization(profile, context, signal)
      ).rejects.toMatchObject({
        kind: 'unknown-result',
        message: expect.stringContaining('截断')
      });
      expect(post).toHaveBeenCalledTimes(1);
    }
  );

  it('never substitutes reasoning content for the actual organization result', async () => {
    const post = vi.fn().mockResolvedValue({
      choices: [
        {
          message: { content: '', reasoning_content: text },
          finish_reason: 'stop'
        }
      ]
    });
    await expect(
      new OpenAiChatAdapter(post).planOrganization(profile, context, signal)
    ).rejects.toThrow('未返回');
  });
});
