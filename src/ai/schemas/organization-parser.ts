import { z } from 'zod';
import type { AiOrganizationContext } from '../organization-types';
import { ORGANIZATION_LIMITS } from './organization-contract';

const pathSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(ORGANIZATION_LIMITS.segmentLength)
      .refine(
        (name) =>
          !/[\\/]/.test(name) &&
          ![...name].some(
            (char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127
          ) &&
          name !== '.' &&
          name !== '..',
        'Invalid folder name'
      )
  )
  .min(1)
  .max(ORGANIZATION_LIMITS.pathDepth);
const folderSchema = z
  .object({
    path: pathSchema,
    purpose: z.string().trim().max(ORGANIZATION_LIMITS.summaryLength)
  })
  .strict();
const assignmentSchema = z
  .object({
    bookmarkId: z.string().min(1).max(128),
    folderPath: pathSchema,
    confidence: z.enum(['high', 'medium', 'low']),
    summary: z.string().trim().max(ORGANIZATION_LIMITS.summaryLength),
    reason: z.string().trim().max(ORGANIZATION_LIMITS.reasonLength)
  })
  .strict();

export const organizationResultSchema = z
  .object({
    folders: z.array(folderSchema).max(ORGANIZATION_LIMITS.foldersPerPlan),
    assignments: z
      .array(assignmentSchema)
      .max(ORGANIZATION_LIMITS.bookmarksPerRequest)
  })
  .strict();

export const organizationSimilaritySchema = z
  .object({
    bookmarkIds: z
      .tuple([z.string().min(1).max(128), z.string().min(1).max(128)])
      .refine(([a, b]) => a !== b, '相似项不得引用自身'),
    reason: z.string().trim().min(1).max(ORGANIZATION_LIMITS.reasonLength),
    confidence: z.enum(['high', 'medium', 'low'])
  })
  .strict();

export function parseOrganizationText(
  text: string,
  mode?: AiOrganizationContext['mode']
) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      value = JSON.parse(cleaned);
    } catch {
      throw new Error('AI 全量规划结果不是有效 JSON');
    }
  }

  // 通读不分配书签，省略的空数组可补齐；归属阶段不能据此推测任何书签去向。
  const normalized =
    (mode === 'taxonomy' || mode === 'merge-taxonomy') &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'assignments')
      ? { ...value, assignments: [] }
      : value;
  const schema =
    mode === 'assign'
      ? organizationResultSchema.extend({
          similarities: z.array(organizationSimilaritySchema).max(80).optional()
        })
      : mode === 'review-similarity'
        ? organizationResultSchema.extend({
            similarities: z.array(organizationSimilaritySchema).max(80)
          })
        : organizationResultSchema;
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'root';
    throw new Error(
      `AI 全量规划结果不符合目录和归属结构：${where} ${issue?.code ?? ''}`.trim()
    );
  }
  return parsed.data;
}
