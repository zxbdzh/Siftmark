import type { AiAdapter } from './adapter';
import type {
  AiAnalysisResult,
  AiCaptureReviewContext,
  AiCaptureReviewResult,
  AiRequestContext,
  CapabilityProbe,
  ModelProfile
} from '../types';
import { buildCaptureReviewPrompt } from '../prompts/capture-review-prompt';
import { captureReviewJsonSchema } from '../schemas/capture-review-contract';
import { parseCaptureReviewText } from '../schemas/capture-review-parser';
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
  chatResponseFormatObject,
  isRejectableProviderError,
  openAiHeaders,
  parseAnalysisText,
  STRUCTURED_OUTPUT_PREFERENCES,
  structuredOutputFor
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
      const startLevel = STRUCTURED_OUTPUT_PREFERENCES.indexOf(
        structuredOutputFor(profile)
      );
      let response: ChatResponse | undefined;
      let lastError: unknown;
      for (
        let level = startLevel;
        level < STRUCTURED_OUTPUT_PREFERENCES.length;
        level += 1
      ) {
        try {
          response = await this.post<ChatResponse>({
            url: appendEndpointPath(profile.endpoint, 'chat/completions'),
            headers: openAiHeaders(profile.apiKey),
            body: {
              model: profile.model,
              messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
              ],
              max_tokens: 256,
              ...chatResponseFormatObject(
                STRUCTURED_OUTPUT_PREFERENCES[level] as 'json_schema',
                { name: 'siftmark_analysis_probe', schema: analysisJsonSchema }
              )
            },
            signal,
            timeoutMs: profile.timeoutMs
          });
          if (response.choices?.[0]?.message?.content) break;
        } catch (error) {
          if (!isRejectableProviderError(error)) throw error;
          lastError = error;
        }
      }
      if (!response) throw lastError;
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
    const startLevel = STRUCTURED_OUTPUT_PREFERENCES.indexOf(
      structuredOutputFor(profile)
    );
    const attempt = (level: number, withEnhancements: boolean) =>
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
          ...chatResponseFormatObject(STRUCTURED_OUTPUT_PREFERENCES[level]!, {
            name: 'siftmark_analysis',
            schema: analysisJsonSchema
          })
        }
      });

    let response: ChatResponse | undefined;
    let enhancementsAccepted = true;
    let lastError: unknown;
    for (
      let level = startLevel;
      level < STRUCTURED_OUTPUT_PREFERENCES.length;
      level += 1
    ) {
      if (hasEnhancements) {
        try {
          const candidate = await attempt(level, true);
          if (candidate.choices?.[0]?.message?.content) {
            response = candidate;
            break;
          }
        } catch (error) {
          if (!isRejectableProviderError(error)) throw error;
          lastError = error;
        }
      }
      try {
        response = await attempt(level, false);
        enhancementsAccepted = false;
        break;
      } catch (error) {
        if (!isRejectableProviderError(error)) throw error;
        lastError = error;
      }
    }
    if (!response) throw lastError;
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

  async reviewCaptureHistory(
    profile: ModelProfile,
    context: AiCaptureReviewContext,
    signal: AbortSignal
  ): Promise<AiCaptureReviewResult> {
    const prompt = buildCaptureReviewPrompt(context);
    const startLevel = STRUCTURED_OUTPUT_PREFERENCES.indexOf(
      structuredOutputFor(profile)
    );
    let response: ChatResponse | undefined;
    let lastError: unknown;
    for (
      let level = startLevel;
      level < STRUCTURED_OUTPUT_PREFERENCES.length;
      level += 1
    ) {
      try {
        response = await this.post<ChatResponse>({
          url: appendEndpointPath(profile.endpoint, 'chat/completions'),
          headers: openAiHeaders(profile.apiKey),
          body: {
            model: profile.model,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user }
            ],
            max_tokens: 1200,
            ...chatResponseFormatObject(STRUCTURED_OUTPUT_PREFERENCES[level]!, {
              name: 'siftmark_capture_review',
              schema: captureReviewJsonSchema
            })
          },
          signal,
          timeoutMs: profile.timeoutMs
        });
        const text = response.choices?.[0]?.message?.content;
        if (text) break;
      } catch (error) {
        if (!isRejectableProviderError(error)) throw error;
        lastError = error;
      }
    }
    if (!response) throw lastError;
    const text = response.choices?.[0]?.message?.content;
    if (!text)
      throw new ProviderError(
        'unknown-result',
        'Provider returned no sleep review result'
      );
    return {
      ...parseCaptureReviewText(text),
      usageTokens: response.usage?.total_tokens
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
