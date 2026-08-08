import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { BookmarkList } from '../../../src/ui/manager/BookmarkList';
import { useManagerStore } from '../../../src/ui/manager/manager-store';

describe('BookmarkList', () => {
  beforeEach(() => useManagerStore.setState({ selectedBookmarkIds: new Set(), detailBookmarkId: null }));
  it('uses a stable density row estimate and supports escape clearing', async () => {
    render(<BookmarkList bookmarks={[{ id: 'b1', parentId: '0', index: 0, title: 'A', url: 'https://a.test' }]}/>);
    const list = screen.getByRole('button', { name: /A/ });
    await userEvent.click(list);
    expect(useManagerStore.getState().detailBookmarkId).toBe('b1');
    await userEvent.keyboard('{Escape}');
    expect(useManagerStore.getState().detailBookmarkId).toBeNull();
  });
});
