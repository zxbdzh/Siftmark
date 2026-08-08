import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exportNetscapeBookmarkHtml,
  serializeNetscapeBookmarkHtml
} from '../../../src/backup/netscape-html-exporter';
import {
  parseNetscapeBookmarkFile,
  parseNetscapeBookmarkHtml
} from '../../../src/backup/netscape-html-importer';
import { readBlobText } from '../../../src/backup/blob';

const fixturePath = resolve('tests/fixtures/backup/chrome-bookmarks.html');

describe('Netscape bookmark HTML', () => {
  it('parses nested folders, decodes titles, normalizes root aliases, and ignores icons', async () => {
    const html = await readFile(fixturePath, 'utf8');
    const graph = parseNetscapeBookmarkHtml(html);

    expect(graph).toMatchObject({
      format: 'netscape-html',
      integrity: 'unverified',
      keyPresence: 'none'
    });
    expect(graph.nodes.map(({ title, kind }) => ({ title, kind }))).toEqual([
      { title: '书签栏', kind: 'folder' },
      { title: '开发 & 设计', kind: 'folder' },
      { title: '文档 <主页>', kind: 'bookmark' },
      { title: '新闻', kind: 'bookmark' },
      { title: '其他书签', kind: 'folder' },
      { title: 'Example', kind: 'bookmark' }
    ]);
    expect(graph.nodes[2]).toMatchObject({
      parentSourceId: graph.nodes[1]!.sourceId,
      url: 'https://example.com/docs?a=1&b=2'
    });
    expect(JSON.stringify(graph)).not.toContain('data:image');
  });

  it('recovers useful entries from partial HTML without executing embedded scripts', async () => {
    (
      globalThis as typeof globalThis & { __siftmarkScriptRan?: boolean }
    ).__siftmarkScriptRan = false;
    const html =
      '<script>globalThis.__siftmarkScriptRan=true</script><DL><DT><H3>Folder</H3><DL><DT><A HREF="https://safe.example">Safe';
    const graph = await parseNetscapeBookmarkFile(
      new Blob([html], { type: 'text/html' })
    );

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1]).toMatchObject({
      title: 'Safe',
      url: 'https://safe.example'
    });
    expect(
      (globalThis as typeof globalThis & { __siftmarkScriptRan?: boolean })
        .__siftmarkScriptRan
    ).toBe(false);
  });

  it('exports valid escaped Netscape HTML and round trips the graph', async () => {
    const source = parseNetscapeBookmarkHtml(
      await readFile(fixturePath, 'utf8')
    );
    const html = serializeNetscapeBookmarkHtml(source.nodes, '我的 <书签>');

    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('<TITLE>我的 &lt;书签&gt;</TITLE>');
    expect(html).toContain('文档 &lt;主页&gt;');
    expect(html).toContain('HREF="https://example.com/docs?a=1&amp;b=2"');
    expect(
      parseNetscapeBookmarkHtml(html).nodes.map((node) => node.title)
    ).toEqual(source.nodes.map((node) => node.title));
    expect(
      await readBlobText(exportNetscapeBookmarkHtml(source.nodes))
    ).toContain('<DL><p>');
  });

  it('rejects files without bookmark entries and unsafe URLs', () => {
    expect(() =>
      parseNetscapeBookmarkHtml('<html><body>empty</body></html>')
    ).toThrow('bookmark-html-list-missing');
    expect(() =>
      parseNetscapeBookmarkHtml(
        '<DL><DT><A HREF="javascript:alert(1)">Bad</A></DL>'
      )
    ).toThrow('unsupported-bookmark-url');
  });
});
