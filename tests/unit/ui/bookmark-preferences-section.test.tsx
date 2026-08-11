import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSmartBookmarkSettings } from '../../../src/settings/settings-repository';
import { BookmarkPreferencesSection } from '../../../src/ui/options/BookmarkPreferencesSection';

describe('BookmarkPreferencesSection', () => {
  afterEach(cleanup);

  it('saves the maximum new-folder levels and preferred folder depth', async () => {
    const user = userEvent.setup();
    const repository = {
      getSmartBookmarkSettings: vi.fn().mockResolvedValue({
        ...defaultSmartBookmarkSettings,
        maxNewFolderLevels: 2,
        preferredFolderDepth: 3
      }),
      setSmartBookmarkSettings: vi.fn().mockResolvedValue(undefined)
    };

    render(<BookmarkPreferencesSection repository={repository as never} />);

    const maximum = await screen.findByRole('slider', {
      name: '单次最多新建层级'
    });
    const preferred = screen.getByRole('slider', {
      name: '推荐目录深度'
    });
    expect(maximum).toHaveValue('2');
    expect(preferred).toHaveValue('3');

    fireEvent.change(maximum, { target: { value: '4' } });
    fireEvent.change(preferred, { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: '保存偏好' }));

    await waitFor(() =>
      expect(repository.setSmartBookmarkSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          maxNewFolderLevels: 4,
          preferredFolderDepth: 2
        })
      )
    );
  });

  it('enables network search and screenshot recognition by default and saves opt-out', async () => {
    const user = userEvent.setup();
    const repository = {
      getSmartBookmarkSettings: vi
        .fn()
        .mockResolvedValue(defaultSmartBookmarkSettings),
      setSmartBookmarkSettings: vi.fn().mockResolvedValue(undefined)
    };

    render(<BookmarkPreferencesSection repository={repository as never} />);

    const webSearch = await screen.findByRole('checkbox', {
      name: /AI 联网搜索/
    });
    const vision = screen.getByRole('checkbox', { name: /AI 页面识图/ });
    expect(webSearch).toBeChecked();
    expect(vision).toBeChecked();

    await user.click(webSearch);
    await user.click(vision);
    await user.click(screen.getByRole('button', { name: '保存偏好' }));

    await waitFor(() =>
      expect(repository.setSmartBookmarkSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          enableWebSearch: false,
          enableVision: false
        })
      )
    );
  });
});
