import type { BookmarkRepository } from './ports';
import { isBookmark } from './types';

export interface BrowserTab { id?: number; title?: string; url?: string; }
export interface SaveResult { bookmarkId?: string; duplicateId?: string; analysisQueued: boolean; status: 'saved' | 'duplicate' | 'unsupported'; }
export interface AnalysisQueue { enqueue(input: { bookmarkId: string; tabId?: number }): Promise<unknown>; }

export class SaveService {
  constructor(private readonly bookmarks: BookmarkRepository, private readonly queue: AnalysisQueue) {}

  async saveCurrentTab(tab: BrowserTab, parentId?: string): Promise<SaveResult> {
    if (!tab.url || !isSupportedUrl(tab.url)) return { status: 'unsupported', analysisQueued: false };
    const nodes = await this.bookmarks.getTree();
    const duplicate = nodes.find((node) => isBookmark(node) && node.url === tab.url);
    if (duplicate) return { status: 'duplicate', duplicateId: duplicate.id, analysisQueued: false };
    const destination = parentId ?? nodes.findLast((node) => !isBookmark(node) && node.parentId === '0')?.id;
    if (!destination) throw new Error('No bookmark destination available');
    const created = await this.bookmarks.create({ parentId: destination, index: 0, title: tab.title || tab.url, url: tab.url });
    void this.queue.enqueue({ bookmarkId: created.id, tabId: tab.id });
    return { status: 'saved', bookmarkId: created.id, analysisQueued: true };
  }

  async saveTabs(tabs: BrowserTab[], parentId?: string): Promise<SaveResult[]> {
    const seen = new Set<string>();
    const unique = tabs.filter((tab) => tab.url && isSupportedUrl(tab.url) && !seen.has(tab.url) && seen.add(tab.url));
    return Promise.all(unique.map((tab) => this.saveCurrentTab(tab, parentId)));
  }
}

function isSupportedUrl(url: string): boolean { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } }
