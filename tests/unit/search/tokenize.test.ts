import { describe, expect, it } from 'vitest';
import { editDistanceAtMostOne, tokenize } from '../../../src/search/tokenize';

describe('search tokenization', () => {
  it('builds Chinese bigrams and normalized Latin tokens', () => {
    expect(tokenize('浏览器 Extension')).toEqual(expect.arrayContaining(['浏览', '览器', 'extension']));
  });
  it('limits fuzzy matching to one edit', () => {
    expect(editDistanceAtMostOne('browser', 'brower')).toBe(true);
    expect(editDistanceAtMostOne('browser', 'banana')).toBe(false);
  });
});
