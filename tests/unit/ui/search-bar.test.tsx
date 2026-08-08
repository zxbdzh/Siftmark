import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchBar } from '../../../src/ui/search/SearchBar';

describe('SearchBar', () => {
  it('debounces local search and exposes the mode', async () => {
    const service = { search: vi.fn().mockResolvedValue([{ bookmarkId: 'b', title: '书签', url: 'https://a.test', score: 1, mode: 'local' }]) };
    render(<SearchBar service={service as never} onResults={vi.fn()}/>);
    await userEvent.type(screen.getByLabelText('搜索书签'), '书签');
    expect(screen.getByText('本地搜索')).toBeVisible();
    await vi.waitFor(() => expect(service.search).toHaveBeenCalled());
  });
});
