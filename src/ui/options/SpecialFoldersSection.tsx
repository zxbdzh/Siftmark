import { FolderPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../../bookmarks/types';
import type { ChromeSettingsRepository, SpecialFolderSettings } from '../../settings/settings-repository';

const rows: Array<{ key: keyof SpecialFolderSettings; label: string; defaultName: string }> = [
  { key: 'inboxId', label: '待整理箱', defaultName: 'Siftmark 待整理' },
  { key: 'archiveId', label: '归档', defaultName: 'Siftmark 归档' },
  { key: 'recycleBinId', label: '回收站', defaultName: 'Siftmark 回收站' }
];

export function SpecialFoldersSection({ settings, bookmarks }: { settings?: ChromeSettingsRepository; bookmarks?: BookmarkRepository }) {
  const [folders, setFolders] = useState<BookmarkNode[]>([]);
  const [value, setValue] = useState<SpecialFolderSettings>({});
  const [status, setStatus] = useState('');
  const refresh = useCallback(async () => { if (bookmarks) setFolders((await bookmarks.getTree()).filter((node) => !isBookmark(node))); }, [bookmarks]);
  useEffect(() => { void Promise.all([settings?.getSpecialFolders().then(setValue), refresh()]); }, [refresh, settings]);
  const bind = async (key: keyof SpecialFolderSettings, folderId: string) => { const next = { ...value, [key]: folderId || undefined }; setValue(next); await settings?.setSpecialFolders(next); setStatus('特殊文件夹绑定已保存'); };
  const create = async (row: typeof rows[number]) => {
    if (!bookmarks) return;
    const parentId = folders.findLast((folder) => folder.parentId === '0')?.id ?? folders[0]?.id;
    if (!parentId) return;
    const folder = await bookmarks.create({ parentId, index: 0, title: row.defaultName });
    await refresh();
    await bind(row.key, folder.id);
  };
  return <section><h2>特殊文件夹</h2><div className="special-folder-grid">{rows.map((row) => { const selected = value[row.key]; const missing = selected && !folders.some((folder) => folder.id === selected); return <div className="special-folder-row" key={row.key}><label>{row.label}<select value={missing ? '' : selected ?? ''} onChange={(event) => void bind(row.key, event.target.value)}><option value="">未绑定</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title || '书签'}</option>)}</select></label><span className={missing ? 'status-warning' : ''}>{missing ? '原文件夹已删除，相关流程已暂停' : selected ? '绑定正常' : '未配置'}</span><button type="button" onClick={() => void create(row)} disabled={!bookmarks}><FolderPlus size={16}/>创建并绑定</button></div>; })}</div><output>{status}</output></section>;
}
