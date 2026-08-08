import type { ThumbnailRepository } from '../storage/thumbnail-repository';
import type { ThumbnailRecord } from '../storage/schema';
import { processImageDataUrl, type ProcessedImage } from './image-processing';

export const THUMBNAIL_BUDGET_BYTES = 200 * 1024 * 1024;

export interface VisibleTabCaptureApi { captureVisibleTab(windowId?: number, options?: { format?: 'jpeg' | 'png'; quality?: number }): Promise<string> }
export interface ThumbnailCaptureInput { bookmarkId: string; windowId?: number; tabId?: number; activeTabId?: number; screenshotAllowed: boolean }

export class ThumbnailService {
  constructor(private readonly api: VisibleTabCaptureApi, private readonly repository: ThumbnailRepository, private readonly process: (dataUrl: string) => Promise<ProcessedImage> = processImageDataUrl, private readonly now: () => number = Date.now) {}

  async captureCurrentTab(input: ThumbnailCaptureInput): Promise<ThumbnailRecord> {
    if (!input.screenshotAllowed) return this.fail(input.bookmarkId, 'restricted');
    if (input.tabId !== undefined && input.activeTabId !== undefined && input.tabId !== input.activeTabId) return this.fail(input.bookmarkId, 'tab-changed');
    const startedAt = this.now();
    await this.repository.put({ bookmarkId: input.bookmarkId, state: 'capturing', createdAt: startedAt, lastAccessedAt: startedAt });
    try {
      let source: string | undefined = await this.api.captureVisibleTab(input.windowId, { format: 'png' });
      const processed = await this.process(source);
      source = undefined;
      const existing = await this.repository.findByHash(processed.hash);
      const record: ThumbnailRecord = { bookmarkId: input.bookmarkId, blob: existing?.blob ?? processed.blob, hash: processed.hash, width: processed.width, height: processed.height, state: 'ready', createdAt: this.now(), lastAccessedAt: this.now() };
      await this.repository.put(record);
      await enforceThumbnailBudget(this.repository);
      return record;
    } catch (error) {
      const kind = error instanceof Error && error.message === 'decode' ? 'decode' : error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'unknown';
      return this.fail(input.bookmarkId, kind);
    }
  }

  private async fail(bookmarkId: string, errorKind: NonNullable<ThumbnailRecord['errorKind']>): Promise<ThumbnailRecord> {
    const record: ThumbnailRecord = { bookmarkId, state: 'failed', errorKind, createdAt: this.now(), lastAccessedAt: this.now() };
    await this.repository.put(record);
    return record;
  }
}

export async function enforceThumbnailBudget(repository: ThumbnailRepository, maximumBytes = THUMBNAIL_BUDGET_BYTES): Promise<string[]> {
  const rows = (await repository.list()).filter((row) => row.state === 'ready' && row.blob).sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
  let total = rows.reduce((sum, row) => sum + (row.blob?.size ?? 0), 0);
  const deleted: string[] = [];
  for (const row of rows) {
    if (total <= maximumBytes) break;
    total -= row.blob?.size ?? 0;
    await repository.delete(row.bookmarkId);
    deleted.push(row.bookmarkId);
  }
  return deleted;
}
