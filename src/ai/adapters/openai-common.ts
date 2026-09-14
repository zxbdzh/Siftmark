import { analysisResultSchema } from '../schemas/analysis-schema';
import {
  ANALYSIS_RESULT_FIELDS,
  analysisJsonSchema
} from '../schemas/analysis-contract';
import { ProviderError } from '../network/errors';
import {
  DEFAULT_STRUCTURED_OUTPUT,
  type AiAnalysisResult,
  type AiStructuredOutput,
  type ModelProfile
} from '../types';
import type { ZodIssue } from 'zod';

export function appendEndpointPath(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function openAiHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

export const STRUCTURED_OUTPUT_PREFERENCES: AiStructuredOutput[] = [
  'json_schema',
  'json_object',
  'prompt-only'
];

export function structuredOutputFor(
  profile: Pick<ModelProfile, 'protocol' | 'structuredOutput'>
): AiStructuredOutput {
  return profile.structuredOutput ?? DEFAULT_STRUCTURED_OUTPUT;
}

export function isRejectableProviderError(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    error.kind === 'validation' &&
    (error.status === 400 || error.status === 422)
  );
}

interface NamedStructuredSchema {
  name: string;
  schema: unknown;
}

/**
 * OpenAI Chat Completions 的 response_format 值。
 * prompt-only 返回 undefined（不发送该字段，完全靠提示词契约）。
 */
export function chatStructuredOutputFormat(
  kind: AiStructuredOutput,
  named: NamedStructuredSchema
):
  | {
      type: 'json_schema';
      json_schema: { name: string; strict: true; schema: unknown };
    }
  | { type: 'json_object' }
  | undefined {
  if (kind === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: named.name,
        strict: true,
        schema: named.schema
      }
    };
  }
  if (kind === 'json_object') return { type: 'json_object' };
  return undefined;
}

/** 把 Chat response_format 以可为空的 body 片段返回，便于展开进请求体。 */
export function chatResponseFormatObject(
  kind: AiStructuredOutput,
  named: NamedStructuredSchema
): Record<string, unknown> {
  const format = chatStructuredOutputFormat(kind, named);
  return format ? { response_format: format } : {};
}

/**
 * OpenAI Responses 的 text.format 对象。prompt-only 返回 {}（省略 text 字段）。
 */
export function responsesTextObject(
  kind: AiStructuredOutput,
  named: NamedStructuredSchema
): Record<string, unknown> {
  if (kind === 'json_schema') {
    return {
      text: {
        format: {
          type: 'json_schema',
          name: named.name,
          strict: true,
          schema: named.schema
        }
      }
    };
  }
  if (kind === 'json_object') {
    return { text: { format: { type: 'json_object' } } };
  }
  return {};
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

export { analysisJsonSchema };
