import type { BookmarkRepository } from './ports';
import { isBookmark } from './types';
import type { OperationRepository } from '../operations/operation-repository';

export interface BrowserTab {
  id?: number;
  title?: string;
  url?: string;
}
export type DuplicateAction = 'cancel' | 'create-copy' | 'update-title';
export interface SaveResult {
  bookmarkId?: string;
  duplicateId?: string;
  operationId?: string;
  batchId?: string;
  taskId?: string;
  analysisQueued: boolean;
  status: 'saved' | 'updated' | 'duplicate' | 'unsupported';
}
export interface AnalysisQueue {
  enqueue(input: {
    bookmarkId: string;
    tabId?: number;
    taskId: string;
  }): Promise<unknown>;
}
export interface SaveOptions {
  parentId?: string;
  duplicateAction?: DuplicateAction;
  queueAnalysis?: boolean;
  batchId?: string;
  batchIndex?: number;
}

export class SaveService {
  constructor(
    private readonly bookmarks: BookmarkRepository,
    private readonly queue: AnalysisQueue,
    private readonly operations?: OperationRepository,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now
  ) {}

  async previewDuplicates(
    tab: BrowserTab
  ): Promise<Array<{ id: string; title: string; parentId: string }>> {
    if (!tab.url || !isSupportedUrl(tab.url)) return [];
    return (await this.bookmarks.getTree())
      .filter((node) => isBookmark(node) && node.url === tab.url)
      .map(({ id, title, parentId }) => ({ id, title, parentId }));
  }

  async saveCurrentTab(
    tab: BrowserTab,
    options: string | SaveOptions = {}
  ): Promise<SaveResult> {
    return this.saveCurrentTabInternal(tab, options, false);
  }

  private async saveCurrentTabInternal(
    tab: BrowserTab,
    options: string | SaveOptions,
    deferAnalysis: boolean
  ): Promise<SaveResult> {
    if (!tab.url || !isSupportedUrl(tab.url))
      return { status: 'unsupported', analysisQueued: false };
    const normalizedOptions =
      typeof options === 'string' ? { parentId: options } : options;
    const nodes = await this.bookmarks.getTree();
    const duplicate = nodes.find(
      (node) => isBookmark(node) && node.url === tab.url
    );
    if (duplicate && normalizedOptions.duplicateAction !== 'create-copy') {
      if (normalizedOptions.duplicateAction === 'update-title') {
        await this.bookmarks.update(duplicate.id, {
          title: tab.title || duplicate.title
        });
        return {
          status: 'updated',
          duplicateId: duplicate.id,
          bookmarkId: duplicate.id,
          analysisQueued: false
        };
      }
      return {
        status: 'duplicate',
        duplicateId: duplicate.id,
        analysisQueued: false
      };
    }
    const destination =
      normalizedOptions.parentId ??
      nodes.findLast((node) => !isBookmark(node) && node.parentId === '0')?.id;
    if (!destination) throw new Error('No bookmark destination available');
    const created = await this.bookmarks.create({
      parentId: destination,
      index: 0,
      title: tab.title || tab.url,
      url: tab.url
    });
    const operationId = this.createId();
    const taskId = this.createId();
    if (this.operations) {
      await this.operations.put({
        id: operationId,
        type: 'create',
        bookmarkId: created.id,
        batchId: normalizedOptions.batchId,
        batchIndex: normalizedOptions.batchIndex,
        before: {},
        after: { ...created },
        idempotencyKey: this.createId(),
        createdAt: this.now()
      });
    }
    const analysisQueued = normalizedOptions.queueAnalysis !== false;
    if (analysisQueued && !deferAnalysis)
      void this.queue.enqueue({
        bookmarkId: created.id,
        tabId: tab.id,
        taskId
      });
    return {
      status: 'saved',
      bookmarkId: created.id,
      operationId: this.operations ? operationId : undefined,
      batchId: this.operations ? normalizedOptions.batchId : undefined,
      taskId: analysisQueued ? taskId : undefined,
      analysisQueued
    };
  }

  async saveTabs(
    tabs: BrowserTab[],
    options: string | SaveOptions = {}
  ): Promise<SaveResult[]> {
    const seen = new Set<string>();
    const unique = tabs.filter(
      (tab) =>
        tab.url &&
        isSupportedUrl(tab.url) &&
        !seen.has(tab.url) &&
        seen.add(tab.url)
    );
    const normalizedOptions =
      typeof options === 'string' ? { parentId: options } : options;
    const batchId = this.operations ? this.createId() : undefined;
    const results: SaveResult[] = [];
    for (const [batchIndex, tab] of unique.entries())
      results.push(
        await this.saveCurrentTabInternal(
          tab,
          { ...normalizedOptions, batchId, batchIndex },
          true
        )
      );
    for (const [index, result] of results.entries()) {
      if (result.analysisQueued && result.bookmarkId && result.taskId)
        void this.queue.enqueue({
          bookmarkId: result.bookmarkId,
          tabId: unique[index]?.id,
          taskId: result.taskId
        });
    }
    return results;
  }
}

function isSupportedUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
