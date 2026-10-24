import type { OrganizationSimilarity } from '../ai/organization-types';
import type { SiftmarkDatabase } from '../storage/database';
import type { BookmarkRepository } from './ports';
import type { BookmarkNode } from './types';
import { isBookmark } from './types';
import { organizationScope } from './organize-bookmarks';
import { similarityKey } from './organization-similarity';

export interface OrganizationReviewRecord {
  id: string;
  bookmarks: BookmarkNode[];
  reason: string;
  confidence: OrganizationSimilarity['confidence'];
  state: 'pending' | 'kept-all' | 'kept-one' | 'failed';
  keepBookmarkId?: string;
  error?: string;
  backupFilename?: string;
  updatedAt: number;
}

export class OrganizationReviewRepository {
  constructor(private readonly db: SiftmarkDatabase) {}
  list() {
    return this.db.organizationReviews.orderBy('updatedAt').reverse().toArray();
  }
  async record(
    pairs: OrganizationSimilarity[],
    bookmarks: BookmarkNode[],
    keepers: Record<string, string> = {}
  ) {
    const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
    await this.db.transaction('rw', this.db.organizationReviews, async () => {
      for (const pair of pairs) {
        const mappedIds = pair.bookmarkIds
          .map((bookmarkId) => keepers[bookmarkId] ?? bookmarkId)
          .sort() as [string, string];
        const sourceId = similarityKey(pair.bookmarkIds);
        const id = similarityKey(mappedIds);
        const snapshots = mappedIds.map((bookmarkId) => byId.get(bookmarkId));
        if (snapshots.some((bookmark) => !bookmark || !isBookmark(bookmark)))
          throw new Error('相似记录缺少有效书签');
        if (
          sourceId !== id &&
          (await this.db.organizationReviews.get(sourceId))
        )
          await this.db.organizationReviews.delete(sourceId);
        const previous = await this.db.organizationReviews.get(id);
        // 已处理的相同建议不反复打扰；名称或网址变化则作为新建议重新审核。
        const unchanged = previous?.bookmarks.every(
          (bookmark, index) =>
            bookmark.id === snapshots[index]!.id &&
            bookmark.title === snapshots[index]!.title &&
            bookmark.url === snapshots[index]!.url
        );
        await this.db.organizationReviews.put({
          id,
          bookmarks: snapshots as BookmarkNode[],
          reason: pair.reason,
          confidence: pair.confidence,
          state: unchanged ? previous!.state : 'pending',
          ...(unchanged
            ? {
                keepBookmarkId: previous!.keepBookmarkId,
                error: previous!.error,
                backupFilename: previous!.backupFilename
              }
            : {}),
          updatedAt: Date.now()
        });
      }
    });
  }
}

export async function resolveOrganizationReview(options: {
  db: SiftmarkDatabase;
  recordId: string;
  keepBookmarkId?: string;
  bookmarks: Pick<BookmarkRepository, 'getTree'>;
  excludedFolderIds: string[];
  backup: (nodes: BookmarkNode[]) => Promise<string>;
  recycle: (bookmark: BookmarkNode, keeper: BookmarkNode) => Promise<void>;
}) {
  const record = await options.db.organizationReviews.get(options.recordId);
  if (!record || !['pending', 'failed'].includes(record.state))
    throw new Error('该相似建议已处理，请刷新后查看');
  if (!options.keepBookmarkId) {
    const next: OrganizationReviewRecord = {
      ...record,
      state: 'kept-all',
      error: undefined,
      updatedAt: Date.now()
    };
    await options.db.organizationReviews.put(next);
    return next;
  }
  const keeper = record.bookmarks.find(
    (bookmark) => bookmark.id === options.keepBookmarkId
  );
  if (!keeper || record.bookmarks.length !== 2)
    throw new Error('所选保留项不属于这对书签');
  const validate = (nodes: BookmarkNode[]) => {
    const scope = organizationScope(nodes, options.excludedFolderIds).targets;
    for (const snapshot of record.bookmarks) {
      const current = scope.find((node) => node.id === snapshot.id);
      if (
        !current ||
        current.url !== snapshot.url ||
        current.title !== snapshot.title
      )
        throw new Error(
          '书签已删除、变更或移入受保护目录；未回收，请重新生成建议'
        );
    }
    return scope;
  };
  try {
    const nodes = await options.bookmarks.getTree();
    const before = validate(nodes);
    const backupFilename = await options.backup(nodes);
    // 下载与用户确认之间可能发生编辑，回收前再次检查整对，避免只剩无效保留项。
    const live = validate(await options.bookmarks.getTree());
    if (
      record.bookmarks.some(
        (snapshot) =>
          live.find((node) => node.id === snapshot.id)!.parentId !==
          before.find((node) => node.id === snapshot.id)!.parentId
      )
    )
      throw new Error('备份期间书签位置发生变化，未回收');
    const victim = live.find(
      (node) =>
        record.bookmarks.some((item) => item.id === node.id) &&
        node.id !== keeper.id
    )!;
    await options.recycle(
      victim,
      live.find((node) => node.id === keeper.id)!
    );
    const next: OrganizationReviewRecord = {
      ...record,
      keepBookmarkId: keeper.id,
      state: 'kept-one',
      backupFilename,
      error: undefined,
      updatedAt: Date.now()
    };
    await options.db.organizationReviews.put(next);
    return next;
  } catch (error) {
    await options.db.organizationReviews.put({
      ...record,
      state: 'failed',
      error:
        error instanceof Error ? error.message : '回收未完成，保留当前状态',
      updatedAt: Date.now()
    });
    throw error;
  }
}
