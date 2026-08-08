import { describe, expect, it } from 'vitest';
import { detectDuplicates } from '../../../src/health/duplicate-detector';

describe('detectDuplicates', () => {
  it('groups exact normalized URLs and retains the earliest bookmark', () => {
    const result = detectDuplicates([
      { id: 'new', parentId: 'f', index: 1, title: '文档', url: 'https://example.com/docs?utm_source=x', dateAdded: 20 },
      { id: 'old', parentId: 'f', index: 0, title: '文档', url: 'https://EXAMPLE.com/docs', dateAdded: 10 }
    ]);
    expect(result.exact).toEqual([{ normalizedUrl: 'https://example.com/docs', keepBookmarkId: 'old', bookmarkIds: ['old', 'new'], kind: 'exact' }]);
  });

  it('keeps title/domain similarity separate from exact duplicate groups', () => {
    const result = detectDuplicates([
      { id: 'a', parentId: 'f', index: 0, title: '浏览器扩展开发指南', url: 'https://example.com/a' },
      { id: 'b', parentId: 'f', index: 1, title: '浏览器扩展开发手册', url: 'https://example.com/b' }
    ]);
    expect(result.exact).toEqual([]);
    expect(result.similar).toEqual([{ bookmarkIds: ['a', 'b'], evidence: ['domain', 'title'], kind: 'similar' }]);
  });
});
