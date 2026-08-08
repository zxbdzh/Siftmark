import type { ProposalRepository } from '../ai/proposal';
import type { BookmarkNode } from '../bookmarks/types';
import { isBookmark } from '../bookmarks/types';
import type { MetadataRepository } from '../storage/types';
import { detectDuplicates, type DuplicateDetectionResult } from './duplicate-detector';
import { LinkChecker, type LinkHealth } from './link-checker';

export interface HealthScanResult {
  duplicates: DuplicateDetectionResult;
  links: LinkHealth[];
}

export class HealthScanService {
  constructor(
    private readonly checker: LinkChecker,
    private readonly metadata: MetadataRepository,
    private readonly proposals: ProposalRepository,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  async scan(nodes: BookmarkNode[], signal?: AbortSignal): Promise<HealthScanResult> {
    const bookmarks = nodes.filter(isBookmark);
    const duplicates = detectDuplicates(bookmarks);
    const links = await this.checker.checkMany([...new Set(bookmarks.map((bookmark) => bookmark.url))], { signal, concurrencyPerDomain: 2 });
    const bookmarksByUrl = new Map<string, typeof bookmarks>();
    for (const bookmark of bookmarks) bookmarksByUrl.set(bookmark.url, [...(bookmarksByUrl.get(bookmark.url) ?? []), bookmark]);
    for (const link of links) {
      for (const bookmark of bookmarksByUrl.get(link.url) ?? []) {
        const current = await this.metadata.get(bookmark.id);
        await this.metadata.put({ bookmarkId: bookmark.id, summary: current?.summary ?? '', tags: current?.tags ?? [], note: current?.note ?? '', confidence: current?.confidence ?? 'unknown', reason: current?.reason ?? '', health: link.status, updatedAt: this.now() });
        if (link.status === 'dead') await this.proposals.put({ id: this.createId(), bookmarkId: bookmark.id, sourceSnapshot: bookmark, result: { folderPath: [], title: bookmark.title, tags: current?.tags ?? [], summary: current?.summary ?? '', confidence: 'low', reason: `链接检测返回 ${link.httpStatus ?? '永久失效'}` }, state: 'dead', category: 'dead', healthStatus: link.status, createdAt: this.now() });
      }
    }
    for (const group of duplicates.exact) {
      const keep = bookmarks.find((bookmark) => bookmark.id === group.keepBookmarkId);
      if (!keep) continue;
      const current = await this.metadata.get(keep.id);
      await this.proposals.put({ id: this.createId(), bookmarkId: keep.id, sourceSnapshot: keep, result: { folderPath: [], title: keep.title, tags: current?.tags ?? [], summary: current?.summary ?? '', confidence: 'high', reason: `发现 ${group.bookmarkIds.length} 个相同网址，默认保留最早书签并合并元数据` }, state: 'duplicate', category: 'duplicate', relatedBookmarkIds: group.bookmarkIds, createdAt: this.now() });
    }
    return { duplicates, links };
  }
}
