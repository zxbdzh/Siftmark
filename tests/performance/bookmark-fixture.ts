import type { Page } from '@playwright/test';

export const LARGE_LIBRARY_SEED = 20_260_808;
export const LARGE_LIBRARY_FOLDERS = 200;
export const LARGE_LIBRARY_BOOKMARKS = 10_000;

type HealthState =
  'unchecked' | 'healthy' | 'temporary' | 'dead' | 'restricted' | 'blocked';

interface FixtureBookmark {
  title: string;
  url: string;
  summary: string;
  tags: string[];
  note: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  health: HealthState;
  updatedAt: number;
}

interface FixtureFolder {
  title: string;
  bookmarks: FixtureBookmark[];
}

export interface LargeLibraryResult {
  seed: number;
  folderIds: string[];
  bookmarkIds: string[];
  targetBookmarkId: string;
  targetTitle: string;
}

export function buildLargeLibraryFixture(
  seed = LARGE_LIBRARY_SEED
): FixtureFolder[] {
  const random = seededRandom(seed);
  const healthStates: HealthState[] = [
    'unchecked',
    'healthy',
    'temporary',
    'dead',
    'restricted',
    'blocked'
  ];
  const confidence = ['high', 'medium', 'low', 'unknown'] as const;
  let globalIndex = 0;
  return Array.from({ length: LARGE_LIBRARY_FOLDERS }, (_, folderIndex) => ({
    title:
      folderIndex % 2 === 0
        ? `性能资料夹 ${folderIndex.toString().padStart(3, '0')}`
        : `Performance Folder ${folderIndex.toString().padStart(3, '0')}`,
    bookmarks: Array.from({ length: 50 }, (_, itemIndex) => {
      const index = globalIndex++;
      const duplicate = index > 0 && index % 113 === 0;
      const target = index === LARGE_LIBRARY_BOOKMARKS - 1;
      const title = target
        ? `性能终点书签 ${index}`
        : index % 2 === 0
          ? `本地资料 ${index} · ${Math.floor(random() * 1_000)}`
          : `Local Reference ${index} · ${Math.floor(random() * 1_000)}`;
      return {
        title,
        url: duplicate
          ? `https://duplicate-${index % 31}.siftmark.test/shared`
          : `https://fixture-${folderIndex}.siftmark.test/item/${itemIndex}?seed=${seed}&index=${index}`,
        summary: `固定种子 ${seed} 的摘要 ${index}`,
        tags: ['性能', index % 2 === 0 ? '中文' : 'latin', `组-${index % 17}`],
        note: `离线笔记 ${index}，不触发任何外部网络请求。`,
        confidence: confidence[index % confidence.length]!,
        health: healthStates[index % healthStates.length]!,
        updatedAt: 1_700_000_000_000 + index
      };
    })
  }));
}

export async function seedLargeBookmarkLibrary(
  page: Page,
  seed = LARGE_LIBRARY_SEED
): Promise<LargeLibraryResult> {
  const folders = buildLargeLibraryFixture(seed);
  return page.evaluate(
    async ({ fixture, fixtureSeed }) => {
      const tree = await chrome.bookmarks.getTree();
      const parent = tree[0]?.children?.find((node) => !node.url) ?? tree[0];
      if (!parent) throw new Error('Missing native bookmark root');

      const createdFolders = [] as chrome.bookmarks.BookmarkTreeNode[];
      for (let index = 0; index < fixture.length; index += 20) {
        createdFolders.push(
          ...(await Promise.all(
            fixture.slice(index, index + 20).map((folder, offset) =>
              chrome.bookmarks.create({
                parentId: parent.id,
                index: index + offset,
                title: folder.title
              })
            )
          ))
        );
      }

      const bookmarkInputs = fixture.flatMap((folder, folderIndex) =>
        folder.bookmarks.map((bookmark, itemIndex) => ({
          bookmark,
          itemIndex,
          parentId: createdFolders[folderIndex]!.id
        }))
      );
      const createdBookmarks = [] as Array<{
        node: chrome.bookmarks.BookmarkTreeNode;
        metadata: FixtureBookmark;
      }>;
      for (let index = 0; index < bookmarkInputs.length; index += 250) {
        createdBookmarks.push(
          ...(await Promise.all(
            bookmarkInputs.slice(index, index + 250).map(async (input) => ({
              node: await chrome.bookmarks.create({
                parentId: input.parentId,
                index: input.itemIndex,
                title: input.bookmark.title,
                url: input.bookmark.url
              }),
              metadata: input.bookmark
            }))
          ))
        );
      }

      const request = indexedDB.open('siftmark');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!database.objectStoreNames.contains('bookmarkMetadata')) {
        database.close();
        throw new Error('Siftmark database was not initialized');
      }
      const transaction = database.transaction('bookmarkMetadata', 'readwrite');
      const store = transaction.objectStore('bookmarkMetadata');
      for (const { node, metadata } of createdBookmarks) {
        store.put({
          bookmarkId: node.id,
          summary: metadata.summary,
          tags: metadata.tags,
          note: metadata.note,
          confidence: metadata.confidence,
          reason: '确定性性能夹具',
          health: metadata.health,
          updatedAt: metadata.updatedAt
        });
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();

      const target = createdBookmarks.at(-1)!;
      return {
        seed: fixtureSeed,
        folderIds: createdFolders.map((folder) => folder.id),
        bookmarkIds: createdBookmarks.map(({ node }) => node.id),
        targetBookmarkId: target.node.id,
        targetTitle: target.node.title
      };
    },
    { fixture: folders, fixtureSeed: seed }
  );
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
