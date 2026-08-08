import type { AiAdapter } from './adapter';
import type { AiAnalysisResult, AiRequestContext, CapabilityProbe, ModelProfile } from '../types';
import { buildAnalysisPrompt } from '../prompts/analysis-prompt';
import { postProviderJson, type ProviderJsonRequest } from '../network/http-client';
import { ProviderError } from '../network/errors';
import { appendEndpointPath, parseAnalysisText } from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;
interface AnthropicResponse { content?: Array<{ type?: string; text?: string }>; stop_reason?: string; }

export class AnthropicMessagesAdapter implements AiAdapter {
  readonly protocol = 'anthropic-messages' as const;
  constructor(private readonly post: Poster = postProviderJson) {}

  async testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe> {
    await this.post<AnthropicResponse>({ url: appendEndpointPath(profile.endpoint, 'messages'), headers: headers(profile.apiKey), body: { model: profile.model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with OK.' }] }, signal, timeoutMs: profile.timeoutMs });
    return { authentication: true, text: true, structuredOutput: true, embedding: false };
  }

  async analyze(profile: ModelProfile, context: AiRequestContext, signal: AbortSignal): Promise<AiAnalysisResult> {
    const prompt = buildAnalysisPrompt(context);
    const response = await this.post<AnthropicResponse>({
      url: appendEndpointPath(profile.endpoint, 'messages'), headers: headers(profile.apiKey), signal, timeoutMs: profile.timeoutMs,
      body: { model: profile.model, max_tokens: 1024, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }
    });
    if (response.stop_reason === 'max_tokens') throw new ProviderError('unknown-result', 'Provider response was truncated');
    const text = response.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new ProviderError('unknown-result', 'Provider returned no text result');
    return parseAnalysisText(text);
  }
}

function headers(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
}
