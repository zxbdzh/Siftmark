import { z } from 'zod';

const folderSegmentSchema = z.string().trim().min(1).max(64).refine((value) => {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  return !/[\\/]/.test(value) && !hasControlCharacter;
}, 'Invalid folder segment');
const tagsSchema = z.array(z.string().trim().min(1).max(32)).max(12).refine((tags) => new Set(tags.map((tag) => tag.toLocaleLowerCase())).size === tags.length, 'Tags must be unique');

export const analysisResultSchema = z.object({
  folderPath: z.array(folderSegmentSchema).max(3),
  title: z.string().trim().min(1).max(160),
  tags: tagsSchema,
  summary: z.string().trim().max(240),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().trim().max(120)
}).strict();

export type ValidatedAnalysisResult = z.infer<typeof analysisResultSchema>;
