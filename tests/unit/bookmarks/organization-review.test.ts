import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OrganizationReviewRepository,
  resolveOrganizationReview
} from '../../../src/bookmarks/organization-review';
import { openSiftmarkDatabase } from '../../../src/storage/database';
import type { BookmarkNode } from '../../../src/bookmarks/types';

const names: string[] = [];
afterEach(() => Promise.all(names.splice(0).map((name) => Dexie.delete(name))));

const bookmark = (id: string, title = id): BookmarkNode => ({
  id,
  parentId: 'bar',
  index: 0,
  title,
  url: `https://${id}.example.test/`,
  dateAdded: 1
});

describe('organization similarity reviews', () => {
  it('migrates a recorded pair when the user keeps a different exact-URL copy', async () => {
    const name = `siftmark-review-${crypto.randomUUID()}`;
    names.push(name);
    const db = openSiftmarkDatabase(name);
    const reviews = new OrganizationReviewRepository(db);
    const pair = {
      bookmarkIds: ['copy', 'other'] as [string, string],
      reason: '标题和用途重叠',
      confidence: 'medium' as const
    };
    await reviews.record([pair], [bookmark('copy'), bookmark('other')]);
    await reviews.record([pair], [bookmark('keeper'), bookmark('other')], {
      copy: 'keeper'
    });
    const rows = await reviews.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bookmarks.map((item) => item.id).sort()).toEqual([
      'keeper',
      'other'
    ]);
    db.close();
  });

  it('keeps both bookmarks when the backup fails before recycling', async () => {
    const name = `siftmark-review-backup-${crypto.randomUUID()}`;
    names.push(name);
    const db = openSiftmarkDatabase(name);
    const reviews = new OrganizationReviewRepository(db);
    const nodes = [bookmark('keep'), bookmark('drop')];
    await reviews.record(
      [
        {
          bookmarkIds: ['keep', 'drop'],
          reason: '内容相近',
          confidence: 'high'
        }
      ],
      nodes
    );
    const recycled: string[] = [];
    await expect(
      resolveOrganizationReview({
        db,
        recordId: JSON.stringify(['drop', 'keep']),
        keepBookmarkId: 'keep',
        bookmarks: { getTree: async () => nodes },
        excludedFolderIds: [],
        backup: async () => {
          throw new Error('备份失败');
        },
        recycle: async (node) => {
          recycled.push(node.id);
        }
      })
    ).rejects.toThrow('备份失败');
    expect(recycled).toEqual([]);
    expect(
      await db.organizationReviews.get(JSON.stringify(['drop', 'keep']))
    ).toMatchObject({
      state: 'failed',
      error: '备份失败'
    });
    db.close();
  });
});
