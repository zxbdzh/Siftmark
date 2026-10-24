import { z } from 'zod';
import {
  DEFAULT_STRUCTURED_OUTPUT,
  type ModelProfile
} from '../types';

const endpointSchema = z.string().url().refine((value) => {
  // 兼容内网和自建 HTTP 网关，仍只允许模型请求使用 HTTP(S)。
  return ['http:', 'https:'].includes(new URL(value).protocol);
}, 'Endpoint 仅支持 HTTP 或 HTTPS');

export const modelProfileSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  protocol: z.enum(['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-generate-content']),
  endpoint: endpointSchema,
  model: z.string().trim().min(1),
  apiKey: z.string(),
  timeoutMs: z.number().int().transform((value) => Math.min(120_000, Math.max(5_000, value))),
  capabilities: z.array(z.enum(['classify', 'rename', 'summarize', 'embed'])),
  structuredOutput: z.enum(['json_schema', 'json_object', 'prompt-only']).optional(),
  state: z.enum(['draft', 'verified', 'disabled']),
  verifiedAt: z.number().optional()
}).passthrough();

export function parseModelProfile(value: unknown): ModelProfile {
  const parsed = modelProfileSchema.parse(value);
  return {
    ...parsed,
    structuredOutput: parsed.structuredOutput ?? DEFAULT_STRUCTURED_OUTPUT
  };
}

export type { ModelProfile } from '../types';
