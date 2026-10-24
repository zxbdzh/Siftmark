import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const downloads = {
    download: vi.fn(),
    search: vi.fn(),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
  };
  return {
    downloads,
    browser: { downloads } as { downloads?: typeof downloads }
  };
});
const { downloads, browser: mockedBrowser } = mocks;
vi.mock('wxt/browser', () => ({ browser: mocks.browser }));
import { downloadBookmarkHtml } from '../../../src/backup/download-bookmark-html';

afterEach(() => {
  mockedBrowser.downloads = downloads;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function setup(state = 'in_progress') {
  downloads.download.mockResolvedValue(42);
  downloads.search.mockResolvedValue([{ id: 42, state }]);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:backup'),
    revokeObjectURL: vi.fn()
  });
}
describe('downloadBookmarkHtml', () => {
  it('waits for its own completed download and releases the object URL', async () => {
    setup();
    let done = false;
    const pending = downloadBookmarkHtml([]).then((name) => {
      done = true;
      return name;
    });
    await vi.waitFor(() => expect(downloads.search).toHaveBeenCalled());
    const listener = downloads.onChanged.addListener.mock.calls[0]![0];
    listener({ id: 43, state: { current: 'complete' } });
    await Promise.resolve();
    expect(done).toBe(false);
    listener({ id: 42, state: { current: 'complete' } });
    expect(await pending).toMatch(/^siftmark-before-organize-.*\.html$/);
    expect(downloads.onChanged.removeListener).toHaveBeenCalledWith(listener);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:backup');
  });
  it('rejects interrupted downloads instead of allowing organization', async () => {
    setup('interrupted');
    await expect(downloadBookmarkHtml([])).rejects.toThrow('未开始整理');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('handles completion before the listener was registered', async () => {
    setup('complete');
    await expect(downloadBookmarkHtml([])).resolves.toMatch(/\.html$/);
    expect(downloads.onChanged.removeListener).toHaveBeenCalled();
  });
  it('stops safely when the downloads permission has not been reloaded', async () => {
    mockedBrowser.downloads = undefined;
    await expect(downloadBookmarkHtml([])).rejects.toThrow(
      '重新加载 Siftmark 扩展'
    );
    expect(downloads.download).not.toHaveBeenCalled();
  });
});
