import { describe, expect, it } from 'vitest';
import { isBookmark } from '../../../src/bookmarks/types';

describe('bookmark contracts', () => {
  it('distinguishes bookmarks from folders by URL presence', () => {
    expect(isBookmark({ id: '1', parentId: '0', index: 0, title: 'A', url: 'https://a.test' })).toBe(true);
    expect(isBookmark({ id: '2', parentId: '0', index: 1, title: 'Folder' })).toBe(false);
  });
});
