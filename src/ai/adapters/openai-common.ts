import { analysisResultSchema } from '../schemas/analysis-schema';
import {
  ANALYSIS_RESULT_FIELDS,
  analysisJsonSchema
} from '../schemas/analysis-contract';
import { ProviderError } from '../network/errors';
import type { AiAnalysisResult } from '../types';
import type { ZodIssue } from 'zod';

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
    const repaired = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      value = JSON.parse(repaired);
    } catch {
      throw new ProviderError('validation', 'AI 返回内容不是有效的 JSON');
    }
  }
  const parsed = analysisResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderError(
      'validation',
      describeAnalysisIssues(parsed.error.issues)
    );
  }
  return parsed.data;
}

function describeAnalysisIssues(issues: ZodIssue[]): string {
  const missingFields = new Set<string>();
  const fieldProblems = new Set<string>();
  let hasExtraFields = false;
  let hasRootProblem = false;

  for (const issue of issues) {
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : undefined;
    if (
      issue.code === 'invalid_type' &&
      issue.received === 'undefined' &&
      field &&
      ANALYSIS_RESULT_FIELDS.some((candidate) => candidate === field)
    ) {
      missingFields.add(field);
      continue;
    }
    if (issue.code === 'unrecognized_keys') {
      hasExtraFields = true;
      continue;
    }
    if (!field) {
      hasRootProblem = true;
      continue;
    }
    fieldProblems.add(describeFieldIssue(field, issue));
  }

  const reasons: string[] = [];
  const orderedMissing = ANALYSIS_RESULT_FIELDS.filter((field) =>
    missingFields.has(field)
  );
  if (orderedMissing.length > 0) {
    reasons.push(`缺少必填字段：${orderedMissing.join('、')}`);
  }
  if (hasExtraFields) reasons.push('包含未允许的额外字段');
  if (hasRootProblem) reasons.push('结果必须是包含六个字段的 JSON 对象');
  reasons.push(...fieldProblems);

  return `AI 分析结果校验失败：${reasons.join('；') || '字段不符合约束'}`;
}

function describeFieldIssue(field: string, issue: ZodIssue): string {
  if (issue.code === 'invalid_type') return `${field} 类型不正确`;
  if (issue.code === 'invalid_enum_value') {
    return `${field} 只能为 high、medium 或 low`;
  }
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    const unit = field === 'folderPath' || field === 'tags' ? '数量' : '长度';
    return `${field} ${unit}不符合限制`;
  }
  if (issue.code === 'custom' && field === 'folderPath') {
    return 'folderPath 包含无效目录名';
  }
  if (issue.code === 'custom' && field === 'tags') {
    return 'tags 忽略大小写后不得重复';
  }
  return `${field} 不符合约束`;
}

export function parseProbeText(text: string): void {
  try {
    const value = JSON.parse(text) as { ok?: unknown };
    if (value.ok !== true || Object.keys(value).some((key) => key !== 'ok'))
      throw new Error('invalid probe');
  } catch {
    throw new ProviderError(
      'validation',
      'Provider did not return the required structured probe result'
    );
  }
}

export const probeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean', const: true } }
} as const;

export { analysisJsonSchema };
