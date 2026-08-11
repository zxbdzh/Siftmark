import { z } from 'zod';
import { ANALYSIS_RESULT_LIMITS } from './analysis-contract';

const limits = ANALYSIS_RESULT_LIMITS;

const folderSegmentSchema = z
  .string()
  .trim()
  .min(limits.folderPath.segmentMinLength)
  .max(limits.folderPath.segmentMaxLength)
  .refine((value) => {
    const hasControlCharacter = [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
    return !/[\\/]/.test(value) && !hasControlCharacter;
  }, 'Invalid folder segment');
const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(limits.tags.itemMinLength)
      .max(limits.tags.itemMaxLength)
  )
  .max(limits.tags.maxItems)
  .refine(
    (tags) =>
      new Set(tags.map((tag) => tag.toLocaleLowerCase())).size === tags.length,
    'Tags must be unique'
  );

export const analysisResultSchema = z
  .object({
    folderPath: z.array(folderSegmentSchema).max(limits.folderPath.maxItems),
    title: z
      .string()
      .trim()
      .min(limits.title.minLength)
      .max(limits.title.maxLength),
    tags: tagsSchema,
    summary: z.string().trim().max(limits.summary.maxLength),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string().trim().max(limits.reason.maxLength)
  })
  .strict();

export type ValidatedAnalysisResult = z.infer<typeof analysisResultSchema>;
