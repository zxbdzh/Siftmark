import { browser } from 'wxt/browser';
import type { BookmarkNode } from '../bookmarks/types';
import {
  bookmarkNodesToImportNodes,
  exportNetscapeBookmarkHtml
} from './netscape-html-exporter';

export async function downloadBookmarkHtml(
  nodes: BookmarkNode[]
): Promise<string> {
  const downloads = browser.downloads;
  if (!downloads)
    throw new Error(
      '下载权限尚未生效，请重新加载 Siftmark 扩展后重试；未开始整理'
    );
  const filename = `siftmark-before-organize-${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
  const url = URL.createObjectURL(
    exportNetscapeBookmarkHtml(bookmarkNodesToImportNodes(nodes))
  );
  try {
    const id = await downloads.download({
      url,
      filename,
      conflictAction: 'uniquify'
    });
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        downloads.onChanged.removeListener(onChanged);
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const check = (state?: string) => {
        if (state === 'complete') finish();
        else if (state === 'interrupted')
          finish(new Error('HTML 备份已取消或下载失败，未开始整理'));
      };
      const onChanged = (change: {
        id: number;
        state?: { current?: string };
      }) => {
        if (change.id === id) check(change.state?.current);
      };
      const timeout = setTimeout(
        () => finish(new Error('等待 HTML 备份完成超时，未开始整理')),
        120_000
      );
      downloads.onChanged.addListener(onChanged);
      // 下载可能在监听安装前完成，再查询一次实际状态。
      void downloads.search({ id }).then(
        (items) => {
          if (!items[0]) finish(new Error('未找到 HTML 备份，未开始整理'));
          else check(items[0].state);
        },
        (error: unknown) =>
          finish(
            error instanceof Error ? error : new Error('无法确认 HTML 备份完成')
          )
      );
    });
    return filename;
  } finally {
    URL.revokeObjectURL(url);
  }
}
