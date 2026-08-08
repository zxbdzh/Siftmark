import { z } from 'zod';

export const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priority: z.number().int(),
  createdAt: z.number(),
  enabled: z.boolean(),
  match: z.object({ domain: z.string().optional(), urlPrefix: z.string().optional(), titleIncludes: z.string().optional(), sourceFolderId: z.string().optional() }).strict(),
  actions: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('move'), folderId: z.string().min(1) }),
    z.object({ type: z.literal('tag'), tag: z.string().min(1) }),
    z.object({ type: z.literal('skip-ai') }),
    z.object({ type: z.literal('send-to-inbox') })
  ]))
}).strict();
