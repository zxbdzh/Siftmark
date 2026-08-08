import { analysisResultSchema } from '../schemas/analysis-schema';
import { ProviderError } from '../network/errors';
import type { AiAnalysisResult } from '../types';

export function appendEndpointPath(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function openAiHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

export function parseAnalysisText(text: string): AiAnalysisResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const repaired = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      value = JSON.parse(repaired);
    } catch {
      throw new ProviderError('validation', 'Provider returned invalid analysis JSON');
    }
  }
  const parsed = analysisResultSchema.safeParse(value);
  if (!parsed.success) throw new ProviderError('validation', 'Provider analysis result failed schema validation');
  return parsed.data;
}

export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['folderPath', 'title', 'tags', 'summary', 'confidence', 'reason'],
  properties: {
    folderPath: { type: 'array', maxItems: 3, items: { type: 'string' } },
    title: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' }
  }
} as const;
