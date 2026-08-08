import type { AiAdapter } from './adapter';
import type { AiAnalysisResult, AiRequestContext, CapabilityProbe, ModelProfile } from '../types';
import { buildAnalysisPrompt } from '../prompts/analysis-prompt';
import { postProviderJson, type ProviderJsonRequest } from '../network/http-client';
import { ProviderError } from '../network/errors';
import { analysisJsonSchema, appendEndpointPath, openAiHeaders, parseAnalysisText } from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;

interface ChatResponse { choices?: Array<{ message?: { content?: string } }>; }

export class OpenAiChatAdapter implements AiAdapter {
  readonly protocol = 'openai-chat' as const;
  constructor(private readonly post: Poster = postProviderJson) {}

  async testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe> {
    await this.post<ChatResponse>({ url: appendEndpointPath(profile.endpoint, 'chat/completions'), headers: openAiHeaders(profile.apiKey), body: { model: profile.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8 }, signal, timeoutMs: profile.timeoutMs });
    return { authentication: true, text: true, structuredOutput: true, embedding: profile.capabilities.includes('embed') };
  }

  async analyze(profile: ModelProfile, context: AiRequestContext, signal: AbortSignal): Promise<AiAnalysisResult> {
    const prompt = buildAnalysisPrompt(context);
    const response = await this.post<ChatResponse>({
      url: appendEndpointPath(profile.endpoint, 'chat/completions'), headers: openAiHeaders(profile.apiKey), signal, timeoutMs: profile.timeoutMs,
      body: { model: profile.model, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], response_format: { type: 'json_schema', json_schema: { name: 'siftmark_analysis', strict: true, schema: analysisJsonSchema } } }
    });
    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError('unknown-result', 'Provider returned no text result');
    return parseAnalysisText(text);
  }
}
