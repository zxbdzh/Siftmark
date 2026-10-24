import { describe, expect, it } from 'vitest';
import { groupOrganizationDuplicates } from '../../../src/bookmarks/organization-duplicates';

describe('organization URL groups', () => {
  it('keeps the oldest copy and never merges parameter or fragment differences', () => {
    const bookmark = (id: string, url: string, dateAdded: number) => ({
      id,
      url,
      dateAdded,
      title: id,
      parentId: 'bar',
      index: 0
    });
    const result = groupOrganizationDuplicates([
      bookmark('new', 'https://example.test/?utm_source=x#one', 20),
      bookmark('old', 'https://example.test/?utm_source=x#one', 10),
      bookmark('parameter', 'https://example.test/?utm_source=y#one', 5),
      bookmark('fragment', 'https://example.test/?utm_source=x#two', 5)
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      keepBookmarkId: 'old',
      bookmarks: [
        expect.objectContaining({ id: 'old' }),
        expect.objectContaining({ id: 'new' })
      ]
    });
    expect(result.representatives.map((node) => node.id)).toEqual([
      'old',
      'parameter',
      'fragment'
    ]);
  });
});
