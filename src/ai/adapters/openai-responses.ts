import type { AiAdapter } from './adapter';
import type { AiAnalysisResult, AiRequestContext, CapabilityProbe, ModelProfile } from '../types';
import { buildAnalysisPrompt } from '../prompts/analysis-prompt';
import { postProviderJson, type ProviderJsonRequest } from '../network/http-client';
import { ProviderError } from '../network/errors';
import { analysisJsonSchema, appendEndpointPath, openAiHeaders, parseAnalysisText, parseProbeText, probeJsonSchema } from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;
interface ResponsesResponse { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; }
interface EmbeddingResponse { data?: Array<{ embedding?: number[]; index?: number }>; }

export class OpenAiResponsesAdapter implements AiAdapter {
  readonly protocol = 'openai-responses' as const;
  constructor(private readonly post: Poster = postProviderJson) {}

  async testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe> {
    const needsText = profile.capabilities.some((capability) => capability !== 'embed') || profile.capabilities.length === 0;
    if (needsText) {
      const response = await this.post<ResponsesResponse>({ url: appendEndpointPath(profile.endpoint, 'responses'), headers: openAiHeaders(profile.apiKey), body: { model: profile.model, input: 'Return {"ok":true}.', max_output_tokens: 32, text: { format: { type: 'json_schema', name: 'siftmark_probe', strict: true, schema: probeJsonSchema } } }, signal, timeoutMs: profile.timeoutMs });
      const text = response.output_text ?? response.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
      if (!text) throw new ProviderError('unknown-result', 'Provider returned no probe result');
      parseProbeText(text);
    }
    const embedding = profile.capabilities.includes('embed');
    if (embedding) await this.embed(profile, ['siftmark'], signal);
    return { authentication: true, text: needsText, structuredOutput: needsText, embedding };
  }

  async analyze(profile: ModelProfile, context: AiRequestContext, signal: AbortSignal): Promise<AiAnalysisResult> {
    const prompt = buildAnalysisPrompt(context);
    const response = await this.post<ResponsesResponse>({
      url: appendEndpointPath(profile.endpoint, 'responses'), headers: openAiHeaders(profile.apiKey), signal, timeoutMs: profile.timeoutMs,
      body: { model: profile.model, instructions: prompt.system, input: prompt.user, text: { format: { type: 'json_schema', name: 'siftmark_analysis', strict: true, schema: analysisJsonSchema } } }
    });
    const text = response.output_text ?? response.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
    if (!text) throw new ProviderError('unknown-result', 'Provider returned no text result');
    return parseAnalysisText(text);
  }

  async embed(profile: ModelProfile, texts: string[], signal: AbortSignal): Promise<number[][]> {
    const response = await this.post<EmbeddingResponse>({ url: appendEndpointPath(profile.endpoint, 'embeddings'), headers: openAiHeaders(profile.apiKey), body: { model: profile.model, input: texts, encoding_format: 'float' }, signal, timeoutMs: profile.timeoutMs });
    const vectors = [...(response.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).map((item) => item.embedding);
    if (vectors.length !== texts.length || vectors.some((vector) => !vector || vector.length === 0 || vector.some((value) => !Number.isFinite(value)))) throw new ProviderError('validation', 'Provider returned invalid embeddings');
    return vectors as number[][];
  }
}
