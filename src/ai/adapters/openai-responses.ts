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
      const response = await this.post<ResponsesResponse>({
        url: appendEndpointPath(profile.endpoint, 'responses'),
        headers: openAiHeaders(profile.apiKey),
        body: {
          model: profile.model,
          instructions: prompt.system,
          input: prompt.user,
          max_output_tokens: 256,
          text: {
            format: {
              type: 'json_schema',
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
      const text =
        response.output_text ??
        response.output
          ?.flatMap((item) => item.content ?? [])
          .find((item) => item.type === 'output_text')?.text;
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
    const request = (withEnhancements: boolean) =>
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
            ? { tools: [{ type: 'web_search' as const }] }
            : {}),
          text: {
            format: {
              type: 'json_schema',
              name: 'siftmark_analysis',
              strict: true,
              schema: analysisJsonSchema
            }
          }
        }
      });
    let enhancementsAccepted = true;
    let response: ResponsesResponse;
    try {
      response = await request(true);
    } catch (error) {
      if (!hasEnhancements || !isEnhancementCompatibilityError(error))
        throw error;
      enhancementsAccepted = false;
      response = await request(false);
    }
    const text =
      response.output_text ??
      response.output
        ?.flatMap((item) => item.content ?? [])
        .find((item) => item.type === 'output_text')?.text;
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
