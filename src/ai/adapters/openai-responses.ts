import type { AiAdapter } from './adapter';
import type { AiAnalysisResult, AiRequestContext, CapabilityProbe, ModelProfile } from '../types';
import { buildAnalysisPrompt } from '../prompts/analysis-prompt';
import { postProviderJson, type ProviderJsonRequest } from '../network/http-client';
import { ProviderError } from '../network/errors';
import { analysisJsonSchema, appendEndpointPath, openAiHeaders, parseAnalysisText } from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;
interface ResponsesResponse { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; }

export class OpenAiResponsesAdapter implements AiAdapter {
  readonly protocol = 'openai-responses' as const;
  constructor(private readonly post: Poster = postProviderJson) {}

  async testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe> {
    await this.post<ResponsesResponse>({ url: appendEndpointPath(profile.endpoint, 'responses'), headers: openAiHeaders(profile.apiKey), body: { model: profile.model, input: 'Reply with OK.', max_output_tokens: 8 }, signal, timeoutMs: profile.timeoutMs });
    return { authentication: true, text: true, structuredOutput: true, embedding: profile.capabilities.includes('embed') };
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
}
