import { z } from 'zod';
import { CAPTURE_REVIEW_LIMITS } from './capture-review-contract';

const pathSegment = z
  .string()
  .trim()
  .min(1)
  .max(CAPTURE_REVIEW_LIMITS.segment)
  .refine(
    (value) =>
      !/[\\/]/.test(value) &&
      !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  );

export const captureReviewResultSchema = z
  .object({
    memories: z
      .array(
        z
          .object({
            domain: z.string().trim().min(1).max(CAPTURE_REVIEW_LIMITS.domain),
            action: z.enum(['prefer-folder', 'avoid-folder']),
            destinationPath: z
              .array(pathSegment)
              .max(CAPTURE_REVIEW_LIMITS.destinationDepth),
            confidence: z.enum(['high', 'medium', 'low']),
            summary: z.string().trim().min(1).max(CAPTURE_REVIEW_LIMITS.summary)
          })
          .strict()
      )
      .max(CAPTURE_REVIEW_LIMITS.memories),
    reviewSummary: z.string().trim().max(CAPTURE_REVIEW_LIMITS.reviewSummary)
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.memories.map((memory) => memory.domain.toLocaleLowerCase()))
        .size === value.memories.length,
    { message: '每个域名最多返回一条记忆' }
  );
