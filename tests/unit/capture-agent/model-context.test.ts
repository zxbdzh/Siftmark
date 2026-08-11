import { describe, expect, it } from 'vitest';
import {
  buildCaptureModelContext,
  redactUrlForModel
} from '../../../src/capture-agent';

describe('capture model context', () => {
  it('removes credentials, query parameters, and fragments from URLs', () => {
    expect(
      redactUrlForModel(
        'https://user:secret@example.test/docs?id=private#account'
      )
    ).toBe('https://example.test/docs');
  });

  it('caps related summaries at five and candidate paths at twelve', () => {
    const context = buildCaptureModelContext({
      title: 'Current',
      url: 'https://example.test/current?token=secret',
      pageText: 'x'.repeat(7_000),
      candidateFolders: Array.from({ length: 20 }, (_, index) => ({
        folderId: `folder-${index}`,
        path: ['开发', `${index}`]
      })),
      relatedBookmarks: Array.from({ length: 8 }, (_, index) => ({
        id: `bookmark-${index}`,
        title: `Bookmark ${index}`,
        url: `https://example.test/${index}?token=secret`,
        summary: 's'.repeat(600)
      }))
    });

    expect(context.currentPage.url).toBe('https://example.test/current');
    expect(context.currentPage.pageText).toHaveLength(6_000);
    expect(context.candidateFolders).toHaveLength(12);
    expect(context.relatedBookmarks).toHaveLength(5);
    expect(context.relatedBookmarks[0]).toMatchObject({
      url: 'https://example.test/0',
      summary: 's'.repeat(500)
    });
    expect(context).not.toHaveProperty('notes');
  });
});
