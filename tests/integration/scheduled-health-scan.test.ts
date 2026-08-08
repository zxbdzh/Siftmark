import { describe, expect, it, vi } from 'vitest';
import { ChromeHealthScheduler, HEALTH_SCAN_ALARM } from '../../src/platform/chrome/scheduler';

describe('scheduled health scans', () => {
  it('does not create an alarm until the user opts in', async () => {
    const create = vi.fn();
    const clear = vi.fn().mockResolvedValue(true);
    const get = vi.fn().mockResolvedValue(undefined);
    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    const scheduler = new ChromeHealthScheduler({ create, clear, get }, storage);
    await scheduler.restore();
    expect(create).not.toHaveBeenCalled();
    await scheduler.configure({ enabled: true, cadence: 'weekly', folderIds: ['folder'] });
    expect(create).toHaveBeenCalledWith(HEALTH_SCAN_ALARM, { periodInMinutes: 10_080 });
  });
});
