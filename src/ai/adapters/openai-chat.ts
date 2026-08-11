import type { AiAdapter } from './adapter';
import type {
  AiAnalysisResult,
  AiRequestContext,
  CapabilityProbe,
  ModelProfile
} from '../types';
import {
  buildAnalysisProbePrompt,
  buildAnalysisPrompt
} from '../prompts/analysis-prompt';
import {
  postProviderJson,
  type ProviderJsonRequest
} from '../network/http-client';
import { ProviderError } from '../network/errors';
import {
  analysisJsonSchema,
  appendEndpointPath,
  openAiHeaders,
  parseAnalysisText
} from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number };
}
interface EmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

export class OpenAiChatAdapter implements AiAdapter {
  readonly protocol = 'openai-chat' as const;
  constructor(private readonly post: Poster = postProviderJson) {}

  async testConnection(
    profile: ModelProfile,
    signal: AbortSignal
  ): Promise<CapabilityProbe> {
    const needsText =
      profile.capabilities.some((capability) => capability !== 'embed') ||
      profile.capabilities.length === 0;
    let usageTokens: number | undefined;
    if (needsText) {
      const prompt = buildAnalysisProbePrompt();
      const response = await this.post<ChatResponse>({
        url: appendEndpointPath(profile.endpoint, 'chat/completions'),
        headers: openAiHeaders(profile.apiKey),
        body: {
          model: profile.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          max_tokens: 256,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'siftmark_analysis_probe',
              strict: true,
              schema: analysisJsonSchema
            }
          }
        },
        signal,
        timeoutMs: profile.timeoutMs
      });
      usageTokens = response.usage?.total_tokens;
      const text = response.choices?.[0]?.message?.content;
      if (!text)
        throw new ProviderError(
          'unknown-result',
          'Provider returned no probe result'
        );
      parseAnalysisText(text);
    }
    const embedding = profile.capabilities.includes('embed');
    if (embedding) await this.embed(profile, ['siftmark'], signal);
    return {
      authentication: true,
      text: needsText,
      structuredOutput: needsText,
      embedding,
      usageTokens
    };
  }

  async analyze(
    profile: ModelProfile,
    context: AiRequestContext,
    signal: AbortSignal
  ): Promise<AiAnalysisResult> {
    const prompt = buildAnalysisPrompt(context);
    const hasEnhancements = Boolean(context.imageDataUrl || context.webSearch);
    const userContent = context.imageDataUrl
      ? [
          { type: 'text', text: prompt.user },
          {
            type: 'image_url',
            image_url: { url: context.imageDataUrl, detail: 'low' }
          }
        ]
      : prompt.user;
    const request = (withEnhancements: boolean) =>
      this.post<ChatResponse>({
        url: appendEndpointPath(profile.endpoint, 'chat/completions'),
        headers: openAiHeaders(profile.apiKey),
        signal,
        timeoutMs: profile.timeoutMs,
        body: {
          model: profile.model,
          messages: [
            { role: 'system', content: prompt.system },
            {
              role: 'user',
              content: withEnhancements ? userContent : prompt.user
            }
          ],
          ...(withEnhancements && context.webSearch
            ? { web_search_options: { search_context_size: 'low' as const } }
            : {}),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'siftmark_analysis',
              strict: true,
              schema: analysisJsonSchema
            }
          }
        }
      });
    let enhancementsAccepted = true;
    let response: ChatResponse;
    try {
      response = await request(true);
    } catch (error) {
      if (!hasEnhancements || !isEnhancementCompatibilityError(error))
        throw error;
      enhancementsAccepted = false;
      response = await request(false);
    }
    const text = response.choices?.[0]?.message?.content;
    if (!text)
      throw new ProviderError(
        'unknown-result',
        'Provider returned no text result'
      );
    return {
      ...parseAnalysisText(text),
      usageTokens: response.usage?.total_tokens,
      ...(context.imageDataUrl || context.webSearch
        ? {
            toolUsage: {
              ...(context.imageDataUrl ? { vision: enhancementsAccepted } : {}),
              ...(context.webSearch
                ? {
                    webSearch: enhancementsAccepted
                      ? ('requested' as const)
                      : ('not-used' as const)
                  }
                : {})
            }
          }
        : {})
    };
  }

  async embed(
    profile: ModelProfile,
    texts: string[],
    signal: AbortSignal
  ): Promise<number[][]> {
    const response = await this.post<EmbeddingResponse>({
      url: appendEndpointPath(profile.endpoint, 'embeddings'),
      headers: openAiHeaders(profile.apiKey),
      body: { model: profile.model, input: texts, encoding_format: 'float' },
      signal,
      timeoutMs: profile.timeoutMs
    });
    const vectors = [...(response.data ?? [])]
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => item.embedding);
    if (
      vectors.length !== texts.length ||
      vectors.some(
        (vector) =>
          !vector ||
          vector.length === 0 ||
          vector.some((value) => !Number.isFinite(value))
      )
    )
      throw new ProviderError(
        'validation',
        'Provider returned invalid embeddings'
      );
    return vectors as number[][];
  }
}

function isEnhancementCompatibilityError(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    error.kind === 'validation' &&
    (error.status === 400 || error.status === 422)
  );
}
