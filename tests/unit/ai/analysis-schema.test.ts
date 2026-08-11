import { describe, expect, it } from 'vitest';
import { analysisResultSchema } from '../../../src/ai/schemas/analysis-schema';
import { analysisJsonSchema } from '../../../src/ai/adapters/openai-common';

const valid = {
  folderPath: ['技术'],
  title: '标题',
  tags: ['AI'],
  summary: '摘要',
  confidence: 'high',
  reason: '主题明确'
} as const;

describe('analysisResultSchema', () => {
  it('accepts a valid common result', () =>
    expect(analysisResultSchema.parse(valid)).toEqual(valid));
  it('rejects URLs and unknown output fields', () =>
    expect(() =>
      analysisResultSchema.parse({ ...valid, url: 'https://changed.test' })
    ).toThrow());
  it.each([
    { ...valid, folderPath: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { ...valid, folderPath: ['bad/name'] },
    { ...valid, title: '' },
    { ...valid, tags: ['AI', 'ai'] },
    { ...valid, summary: 'x'.repeat(241) },
    { ...valid, reason: 'x'.repeat(121) }
  ])('rejects invalid constrained output', (value) =>
    expect(() => analysisResultSchema.parse(value)).toThrow()
  );

  it('publishes the local limits in the provider JSON schema', () => {
    const properties = analysisJsonSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.folderPath).toMatchObject({ maxItems: 5 });
    expect(properties.title).toMatchObject({ minLength: 1, maxLength: 160 });
    expect(properties.tags).toMatchObject({ maxItems: 12 });
    expect(properties.summary).toMatchObject({ maxLength: 240 });
    expect(properties.reason).toMatchObject({ maxLength: 120 });
  });
});
