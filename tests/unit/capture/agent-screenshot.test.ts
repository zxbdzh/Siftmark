import { describe, expect, it, vi } from 'vitest';
import { captureAgentScreenshot } from '../../../src/capture/agent-screenshot';

describe('captureAgentScreenshot', () => {
  it('captures a bounded JPEG only for the active policy-approved tab', async () => {
    const api = {
      getTab: vi.fn().mockResolvedValue({ id: 7, windowId: 3 }),
      getActiveTab: vi.fn().mockResolvedValue({ id: 7, windowId: 3 }),
      captureVisibleTab: vi
        .fn()
        .mockResolvedValue('data:image/jpeg;base64,AA==')
    };

    await expect(
      captureAgentScreenshot(api, { tabId: 7, screenshotAllowed: true })
    ).resolves.toBe('data:image/jpeg;base64,AA==');
    expect(api.captureVisibleTab).toHaveBeenCalledWith(3, {
      format: 'jpeg',
      quality: 60
    });
  });

  it('does not capture restricted or background tabs', async () => {
    const api = {
      getTab: vi.fn().mockResolvedValue({ id: 7, windowId: 3 }),
      getActiveTab: vi.fn().mockResolvedValue({ id: 8, windowId: 3 }),
      captureVisibleTab: vi.fn()
    };

    await expect(
      captureAgentScreenshot(api, { tabId: 7, screenshotAllowed: false })
    ).resolves.toBeUndefined();
    await expect(
      captureAgentScreenshot(api, { tabId: 7, screenshotAllowed: true })
    ).resolves.toBeUndefined();
    expect(api.captureVisibleTab).not.toHaveBeenCalled();
  });
});
