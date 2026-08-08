import { z } from 'zod';
import type { ModelProfile } from '../types';

const endpointSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}, 'Endpoint must use HTTPS, except loopback HTTP');

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
  state: z.enum(['draft', 'verified', 'disabled']),
  verifiedAt: z.number().optional()
}).strict();

export function parseModelProfile(value: unknown): ModelProfile {
  return modelProfileSchema.parse(value);
}

export type { ModelProfile } from '../types';
