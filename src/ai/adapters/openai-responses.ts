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
  isRejectableProviderError,
  openAiHeaders,
  parseAnalysisText,
  responsesTextObject,
  STRUCTURED_OUTPUT_PREFERENCES,
  structuredOutputFor
} from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;
interface ResponsesResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { total_tokens?: number };
}
interface EmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

export class OpenAiResponsesAdapter implements AiAdapter {
  readonly protocol = 'openai-responses' as const;
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
      let response: ResponsesResponse | undefined;
      let lastError: unknown;
      for (
        let level = startLevel;
        level < STRUCTURED_OUTPUT_PREFERENCES.length;
        level += 1
      ) {
        try {
          response = await this.post<ResponsesResponse>({
            url: appendEndpointPath(profile.endpoint, 'responses'),
            headers: openAiHeaders(profile.apiKey),
            body: {
              model: profile.model,
              instructions: prompt.system,
              input: prompt.user,
              max_output_tokens: 256,
              ...responsesTextObject(
                STRUCTURED_OUTPUT_PREFERENCES[level] as 'json_schema',
                { name: 'siftmark_analysis_probe', schema: analysisJsonSchema }
              )
            },
            signal,
            timeoutMs: profile.timeoutMs
          });
          if (readResponseText(response)) break;
        } catch (error) {
          if (!isRejectableProviderError(error)) throw error;
          lastError = error;
        }
      }
      if (!response) throw lastError;
      usageTokens = response.usage?.total_tokens;
      const text = readResponseText(response);
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
    const input = context.imageDataUrl
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt.user },
              {
                type: 'input_image',
                image_url: context.imageDataUrl,
                detail: 'low'
              }
            ]
          }
        ]
      : prompt.user;
    const startLevel = STRUCTURED_OUTPUT_PREFERENCES.indexOf(
      structuredOutputFor(profile)
    );
    const attempt = (level: number, withEnhancements: boolean) =>
      this.post<ResponsesResponse>({
        url: appendEndpointPath(profile.endpoint, 'responses'),
        headers: openAiHeaders(profile.apiKey),
        signal,
        timeoutMs: profile.timeoutMs,
        body: {
          model: profile.model,
          instructions: prompt.system,
          input: withEnhancements ? input : prompt.user,
          ...(withEnhancements && context.webSearch
            ? {
                tools: [{ type: 'web_search' as const }],
                tool_choice: 'required' as const
              }
            : {}),
          ...responsesTextObject(STRUCTURED_OUTPUT_PREFERENCES[level]!, {
            name: 'siftmark_analysis',
            schema: analysisJsonSchema
          })
        }
      });
    let enhancementsAccepted = true;
    let response: ResponsesResponse | undefined;
    let lastError: unknown;
    for (
      let level = startLevel;
      level < STRUCTURED_OUTPUT_PREFERENCES.length;
      level += 1
    ) {
      if (hasEnhancements) {
        try {
          const candidate = await attempt(level, true);
          if (readResponseText(candidate)) {
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
    const text = readResponseText(response);
    if (!text)
      throw new ProviderError(
        'unknown-result',
        'Provider returned no text result'
      );
    const webSearchUsage = !context.webSearch
      ? undefined
      : !enhancementsAccepted
        ? ('not-used' as const)
        : response.output?.some((item) => item.type === 'web_search_call')
          ? ('used' as const)
          : ('not-used' as const);
    return {
      ...parseAnalysisText(text),
      usageTokens: response.usage?.total_tokens,
      ...(context.imageDataUrl || webSearchUsage
        ? {
            toolUsage: {
              ...(context.imageDataUrl ? { vision: enhancementsAccepted } : {}),
              ...(webSearchUsage ? { webSearch: webSearchUsage } : {})
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
    let response: ResponsesResponse | undefined;
    let lastError: unknown;
    for (
      let level = startLevel;
      level < STRUCTURED_OUTPUT_PREFERENCES.length;
      level += 1
    ) {
      try {
        response = await this.post<ResponsesResponse>({
          url: appendEndpointPath(profile.endpoint, 'responses'),
          headers: openAiHeaders(profile.apiKey),
          body: {
            model: profile.model,
            instructions: prompt.system,
            input: prompt.user,
            max_output_tokens: 1200,
            ...responsesTextObject(STRUCTURED_OUTPUT_PREFERENCES[level]!, {
              name: 'siftmark_capture_review',
              schema: captureReviewJsonSchema
            })
          },
          signal,
          timeoutMs: profile.timeoutMs
        });
        if (readResponseText(response)) break;
      } catch (error) {
        if (!isRejectableProviderError(error)) throw error;
        lastError = error;
      }
    }
    if (!response) throw lastError;
    const text = readResponseText(response);
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

function readResponseText(response: ResponsesResponse): string | undefined {
  if (response.output_text?.trim()) return response.output_text;
  return response.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text' && item.text?.trim())?.text;
}
