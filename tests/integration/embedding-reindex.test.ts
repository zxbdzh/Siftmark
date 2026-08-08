import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSiftmarkDatabase } from '../../src/storage/database';
import {
  buildEmbeddingText,
  EmbeddingIndexer
} from '../../src/search/embedding/embedding-indexer';
import { EmbeddingRepository } from '../../src/search/embedding/embedding-repository';
import type { SearchDocument } from '../../src/search/types';

const databaseName = 'siftmark-embedding-reindex-test';
const document = (
  bookmarkId: string,
  patch: Partial<SearchDocument> = {}
): SearchDocument => ({
  bookmarkId,
  title: `标题 ${bookmarkId}`,
  url: `https://example.com/path?secret=${bookmarkId}#private`,
  folderId: 'folder',
  folderPath: '资料 / 技术',
  tags: ['本地'],
  summary: '公开摘要',
  note: `私人笔记 ${bookmarkId}`,
  health: 'unchecked',
  confidence: 'unknown',
  createdAt: 1,
  updatedAt: 1,
  ...patch
});

describe('EmbeddingIndexer', () => {
  afterEach(async () => Dexie.delete(databaseName));

  it('uses privacy-limited input, resumes by skipping completed rows, and stales old versions', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const repository = new EmbeddingRepository(database);
    await stage('put old vector', () =>
      repository.put({
        bookmarkId: 'old',
        key: { profileId: 'p@1', vectorVersion: 'old', dimensions: 2 },
        values: [1, 0],
        inputHash: 'old',
        stale: false,
        updatedAt: 1
      })
    );
    const indexer = new EmbeddingIndexer(repository, () => 10);
    const documents = [document('a'), document('b')];
    expect(
      await stage('mark old version stale', () =>
        repository.markOtherVersionsStale({
          profileId: 'p@1',
          vectorVersion: 'new'
        })
      )
    ).toBe(1);
    expect(
      await stage('find missing rows', () =>
        indexer.enqueueMissing(documents, {
          profileId: 'p@1',
          vectorVersion: 'new'
        })
      )
    ).toHaveLength(2);
    const controller = new AbortController();
    const firstEmbed = vi.fn(async (texts: string[]) => {
      expect(texts[0]).not.toContain('secret=');
      expect(texts[0]).not.toContain('私人笔记');
      controller.abort();
      return texts.map(() => [1, 0]);
    });

    const paused = await stage('first index', () =>
      indexer.index(
        documents,
        { profileId: 'p@1', vectorVersion: 'new' },
        { embed: firstEmbed },
        { chunkSize: 1, signal: controller.signal }
      )
    );
    expect(paused).toMatchObject({ state: 'paused', completed: 1, total: 2 });
    expect(
      await stage('list old vectors', () =>
        repository.listByKey({
          profileId: 'p@1',
          vectorVersion: 'old',
          dimensions: 2
        })
      )
    ).toHaveLength(0);

    const resumedEmbed = vi.fn(async (texts: string[]) =>
      texts.map(() => [0, 1])
    );
    const resumed = await stage('resume index', () =>
      indexer.index(
        documents,
        { profileId: 'p@1', vectorVersion: 'new' },
        { embed: resumedEmbed },
        { chunkSize: 1 }
      )
    );
    expect(resumed).toMatchObject({
      state: 'succeeded',
      completed: 1,
      total: 1,
      dimensions: 2
    });
    expect(resumedEmbed).toHaveBeenCalledTimes(1);
    expect(
      await repository.listByKey({
        profileId: 'p@1',
        vectorVersion: 'new',
        dimensions: 2
      })
    ).toHaveLength(2);
    expect(buildEmbeddingText(document('privacy'))).toBe(
      '标题: 标题 privacy\n域名: example.com\n文件夹: 资料 / 技术\n标签: 本地\n摘要: 公开摘要'
    );
    await database.close();
  });

  it('stales vectors from an older version of the same logical profile', async () => {
    const database = openSiftmarkDatabase(databaseName);
    const repository = new EmbeddingRepository(database);
    await repository.put({
      bookmarkId: 'old',
      key: {
        profileId: 'profile@v1',
        vectorVersion: 'model@v1',
        dimensions: 2
      },
      values: [1, 0],
      inputHash: 'old',
      stale: false,
      updatedAt: 1
    });

    expect(
      await repository.markOtherVersionsStale({
        profileId: 'profile@v2',
        vectorVersion: 'model@v2'
      })
    ).toBe(1);
    expect(
      await repository.listByKey({
        profileId: 'profile@v1',
        vectorVersion: 'model@v1',
        dimensions: 2
      })
    ).toHaveLength(0);
    await database.close();
  });
});

async function stage<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}
