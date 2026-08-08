import { describe, expect, it } from 'vitest';
import { analysisResultSchema } from '../../../src/ai/schemas/analysis-schema';

const valid = { folderPath: ['技术'], title: '标题', tags: ['AI'], summary: '摘要', confidence: 'high', reason: '主题明确' } as const;

describe('analysisResultSchema', () => {
  it('accepts a valid common result', () => expect(analysisResultSchema.parse(valid)).toEqual(valid));
  it('rejects URLs and unknown output fields', () => expect(() => analysisResultSchema.parse({ ...valid, url: 'https://changed.test' })).toThrow());
  it.each([
    { ...valid, folderPath: ['a', 'b', 'c', 'd'] },
    { ...valid, folderPath: ['bad/name'] },
    { ...valid, title: '' },
    { ...valid, tags: ['AI', 'ai'] },
    { ...valid, summary: 'x'.repeat(241) },
    { ...valid, reason: 'x'.repeat(121) }
  ])('rejects invalid constrained output', (value) => expect(() => analysisResultSchema.parse(value)).toThrow());
});
