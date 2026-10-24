import { browser } from 'wxt/browser';
import type { BookmarkNode } from '../bookmarks/types';
import { bookmarkNodesToImportNodes, exportNetscapeBookmarkHtml } from './netscape-html-exporter';

/** 下载全量整理前的 HTML 备份，失败时阻止后续整理。 */
export async function downloadSyncBackup(nodes: BookmarkNode[]): Promise<void> {
  if (!browser.downloads) throw new Error('下载权限未生效，请重新加载扩展；未执行同步改动');
  const html = await exportNetscapeBookmarkHtml(bookmarkNodesToImportNodes(nodes)).text();
  const id = await browser.downloads.download({url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html), filename: 'siftmark-before-sync-' + new Date().toISOString().replace(/[:.]/g, '-') + '.html', conflictAction: 'uniquify'});
  await waitForDownload(id, '备份下载');
}

/** 下载已经在本地解密校验过的密文，下载失败不会改变任何业务数据。 */
export async function downloadEncryptedSyncBackup(bytes: Uint8Array): Promise<void> {
  if (!browser.downloads) throw new Error('下载权限未生效，请重新加载扩展');
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], {type: 'application/octet-stream'}));
  try {
    const id = await browser.downloads.download({
      url,
      filename: 'siftmark-webdav-' + new Date().toISOString().replace(/[:.]/g, '-') + '.siftmark-sync',
      conflictAction: 'uniquify'
    });
    await waitForDownload(id, '加密备份下载');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function waitForDownload(id: number, label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {clearTimeout(timer); browser.downloads.onChanged.removeListener(listener); if (error) reject(error); else resolve();};
    const check = (state?: string) => {if (state === 'complete') done(); else if (state === 'interrupted') done(new Error(`${label}中断`));};
    const listener = (delta: {id: number; state?: {current?: string}}) => {if (delta.id === id) check(delta.state?.current);};
    const timer = setTimeout(() => done(new Error(`${label}超时`)), 120000);
    browser.downloads.onChanged.addListener(listener);
    void browser.downloads.search({id}).then(items => {if (items[0]) check(items[0].state); else done(new Error(`无法确认${label}`));}, error => done(new Error(String(error))));
  });
}
