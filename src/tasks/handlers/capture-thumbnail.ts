import type { ThumbnailService } from '../../capture/thumbnail-service';
import type { TaskHandler } from '../types';

export interface CaptureThumbnailInput { bookmarkId: string; windowId?: number; tabId?: number; activeTabId?: number; screenshotAllowed: boolean }

export function createCaptureThumbnailHandler(service: ThumbnailService, prepare: (input: CaptureThumbnailInput) => Promise<CaptureThumbnailInput> = async (input) => input): TaskHandler<CaptureThumbnailInput> {
  return async ({ task, signal, reportProgress }) => {
    if (signal.aborted) return { state: 'cancelled' };
    await reportProgress({ completed: 0, failed: 0 });
    const result = await service.captureCurrentTab(await prepare(task.input));
    await reportProgress({ completed: result.state === 'ready' ? 1 : 0, failed: result.state === 'failed' ? 1 : 0 });
    return result.state === 'ready' ? { state: 'succeeded', completed: 1 } : { state: 'failed', failed: 1 };
  };
}
