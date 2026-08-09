import { describe, expect, it, vi } from 'vitest';
import { ChromeBrowserNotifications } from '../../../src/platform/chrome/browser-notifications';

describe('ChromeBrowserNotifications', () => {
  it('sends only task count and state after optional permission is granted', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'notification-id' });
    const create = vi.fn().mockResolvedValue('notification-id');
    const iconUrl = 'data:image/png;base64,c2lmdG1hcms=';
    const service = new ChromeBrowserNotifications({ contains: vi.fn().mockResolvedValue(true) }, { create }, iconUrl);
    expect(await service.showTaskSummary({ state: 'failed', count: 3 })).toBe(true);
    expect(create).toHaveBeenCalledWith('notification-id', { type: 'basic', iconUrl, title: 'Siftmark 后台任务', message: '3 个项目失败' });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/https?:|API|标题/);
    vi.unstubAllGlobals();
  });

  it('does nothing when notification permission is absent', async () => {
    const create = vi.fn();
    const service = new ChromeBrowserNotifications({ contains: vi.fn().mockResolvedValue(false) }, { create }, 'icon.svg');
    expect(await service.showTaskSummary({ state: 'succeeded', count: 1 })).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects vector icons before calling the browser notification API', async () => {
    const create = vi.fn();
    const service = new ChromeBrowserNotifications(
      { contains: vi.fn().mockResolvedValue(true) },
      { create },
      'icon.svg'
    );

    await expect(
      service.showTaskSummary({ state: 'succeeded', count: 1 })
    ).rejects.toThrow('Notification icon must be a PNG asset');
    expect(create).not.toHaveBeenCalled();
  });
});
