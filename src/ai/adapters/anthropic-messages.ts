import type { AiAdapter } from './adapter';
import type {
  AiAnalysisResult,
  AiCaptureReviewContext,
  AiCaptureReviewResult,
  AiRequestContext,
  CapabilityProbe,
  ModelProfile
} from '../types';
import {
  buildAnalysisProbePrompt,
  buildAnalysisPrompt
} from '../prompts/analysis-prompt';
import { buildCaptureReviewPrompt } from '../prompts/capture-review-prompt';
import { parseCaptureReviewText } from '../schemas/capture-review-parser';
import { postProviderJson, type ProviderJsonRequest } from '../network/http-client';
import { ProviderError } from '../network/errors';
import { appendEndpointPath, parseAnalysisText } from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;
interface AnthropicResponse { content?: Array<{ type?: string; text?: string }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; }

export class AnthropicMessagesAdapter implements AiAdapter {
  readonly protocol = 'anthropic-messages' as const;
  constructor(private readonly post: Poster = postProviderJson) {}

  async testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe> {
    const prompt = buildAnalysisProbePrompt();
    const response = await this.post<AnthropicResponse>({
      url: appendEndpointPath(profile.endpoint, 'messages'),
      headers: headers(profile.apiKey),
      body: {
        model: profile.model,
        max_tokens: 256,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }]
      },
      signal,
      timeoutMs: profile.timeoutMs
    });
    const text = response.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new ProviderError('unknown-result', 'Provider returned no probe result');
    parseAnalysisText(text);
    return { authentication: true, text: true, structuredOutput: true, embedding: false, usageTokens: totalTokens(response.usage) };
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
    return {
      ...parseAnalysisText(text),
      usageTokens: totalTokens(response.usage)
    };
  }

  async reviewCaptureHistory(profile: ModelProfile, context: AiCaptureReviewContext, signal: AbortSignal): Promise<AiCaptureReviewResult> {
    const prompt = buildCaptureReviewPrompt(context);
    const response = await this.post<AnthropicResponse>({
      url: appendEndpointPath(profile.endpoint, 'messages'), headers: headers(profile.apiKey), signal, timeoutMs: profile.timeoutMs,
      body: { model: profile.model, max_tokens: 1200, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }
    });
    if (response.stop_reason === 'max_tokens') throw new ProviderError('unknown-result', 'Provider sleep review was truncated');
    const text = response.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new ProviderError('unknown-result', 'Provider returned no sleep review result');
    return { ...parseCaptureReviewText(text), usageTokens: totalTokens(response.usage) };
  }
}

function totalTokens(usage: AnthropicResponse['usage']): number | undefined {
  if (!usage) return undefined;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

function headers(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
}
