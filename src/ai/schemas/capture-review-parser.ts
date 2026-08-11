import { ProviderError } from '../network/errors';
import type { AiCaptureReviewResult } from '../types';
import { captureReviewResultSchema } from './capture-review-schema';

export function parseCaptureReviewText(text: string): AiCaptureReviewResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    try {
      value = JSON.parse(
        text
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
      );
    } catch {
      throw new ProviderError('validation', '睡眠回顾结果不是有效的 JSON');
    }
  }
  const parsed = captureReviewResultSchema.safeParse(value);
  if (!parsed.success)
    throw new ProviderError('validation', '睡眠回顾结果不符合结构约束');
  return parsed.data;
}
