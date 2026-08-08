import type { AiAdapter } from './adapter';
import type { AiAnalysisResult, AiRequestContext, CapabilityProbe, ModelProfile } from '../types';
import { buildAnalysisPrompt } from '../prompts/analysis-prompt';
import { postProviderJson, type ProviderJsonRequest } from '../network/http-client';
import { ProviderError } from '../network/errors';
import { analysisJsonSchema, appendEndpointPath, parseAnalysisText, parseProbeText, probeJsonSchema } from './openai-common';

type Poster = <T>(request: ProviderJsonRequest) => Promise<T>;
interface GeminiResponse { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: { blockReason?: string }; }

export class GeminiGenerateContentAdapter implements AiAdapter {
  readonly protocol = 'gemini-generate-content' as const;
  constructor(private readonly post: Poster = postProviderJson) {}

  async testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe> {
    const response = await this.post<GeminiResponse>({ url: modelUrl(profile), headers: { 'x-goog-api-key': profile.apiKey }, body: { contents: [{ role: 'user', parts: [{ text: 'Return {"ok":true}.' }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: probeJsonSchema } }, signal, timeoutMs: profile.timeoutMs });
    const candidate = response.candidates?.[0];
    const text = candidate?.content?.parts?.find((part) => part.text)?.text;
    if (!text) throw new ProviderError('unknown-result', 'Provider returned no probe result');
    parseProbeText(text);
    return { authentication: true, text: true, structuredOutput: true, embedding: false };
  }

  async analyze(profile: ModelProfile, context: AiRequestContext, signal: AbortSignal): Promise<AiAnalysisResult> {
    const prompt = buildAnalysisPrompt(context);
    const response = await this.post<GeminiResponse>({
      url: modelUrl(profile), headers: { 'x-goog-api-key': profile.apiKey }, signal, timeoutMs: profile.timeoutMs,
      body: { systemInstruction: { parts: [{ text: prompt.system }] }, contents: [{ role: 'user', parts: [{ text: prompt.user }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: analysisJsonSchema } }
    });
    if (response.promptFeedback?.blockReason) throw new ProviderError('unknown-result', 'Provider blocked the request');
    const candidate = response.candidates?.[0];
    if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) throw new ProviderError('unknown-result', 'Provider returned an incomplete result');
    const text = candidate.content?.parts?.find((part) => part.text)?.text;
    if (!text) throw new ProviderError('unknown-result', 'Provider returned no text result');
    return parseAnalysisText(text);
  }
}

function modelUrl(profile: ModelProfile): string {
  return appendEndpointPath(profile.endpoint, `models/${encodeURIComponent(profile.model)}:generateContent`);
}
