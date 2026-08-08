import { useEffect, useState } from 'react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkNode } from '../../bookmarks/types';
import { isBookmark } from '../../bookmarks/types';
import { HEALTH_SCHEDULE_STORAGE_KEY, type HealthSchedule } from '../../platform/chrome/scheduler';

const VISIT_TRACKING_KEY = 'siftmark.visits.enabled.v1';
const defaultSchedule: HealthSchedule = { enabled: false, cadence: 'weekly', folderIds: [] };

export function HealthAutomationSection({ bookmarks }: { bookmarks: BookmarkRepository }) {
  const [schedule, setSchedule] = useState(defaultSchedule);
  const [folders, setFolders] = useState<BookmarkNode[]>([]);
  const [visits, setVisits] = useState(false);
  useEffect(() => { void Promise.all([browser.storage.local.get([HEALTH_SCHEDULE_STORAGE_KEY, VISIT_TRACKING_KEY]), bookmarks.getTree()]).then(([stored, nodes]) => { const value = stored[HEALTH_SCHEDULE_STORAGE_KEY] as HealthSchedule | undefined; if (value) setSchedule(value); setVisits(stored[VISIT_TRACKING_KEY] === true); setFolders(nodes.filter((node) => !isBookmark(node) && node.title.trim())); }); }, [bookmarks]);
  const updateSchedule = (next: HealthSchedule) => { setSchedule(next); void browser.runtime.sendMessage({ type: 'configure-health-schedule', input: next }); };
  const toggleFolder = (folderId: string) => updateSchedule({ ...schedule, folderIds: schedule.folderIds.includes(folderId) ? schedule.folderIds.filter((id) => id !== folderId) : [...schedule.folderIds, folderId] });
  return <section><h2>健康与访问统计</h2><div className="settings-grid"><label>定时健康检查<select value={schedule.enabled ? schedule.cadence : 'off'} onChange={(event) => updateSchedule(event.target.value === 'off' ? { ...schedule, enabled: false } : { ...schedule, enabled: true, cadence: event.target.value as HealthSchedule['cadence'] })}><option value="off">关闭</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><label>本地访问统计<input type="checkbox" checked={visits} onChange={(event) => { setVisits(event.target.checked); void browser.storage.local.set({ [VISIT_TRACKING_KEY]: event.target.checked }); }}/></label></div>{schedule.enabled ? <fieldset className="folder-scope"><legend>检查范围</legend><label><input type="checkbox" checked={schedule.folderIds.length === 0} onChange={() => updateSchedule({ ...schedule, folderIds: [] })}/>全部书签</label>{folders.map((folder) => <label key={folder.id}><input type="checkbox" checked={schedule.folderIds.includes(folder.id)} onChange={() => toggleFolder(folder.id)}/>{folder.title}</label>)}</fieldset> : null}</section>;
}
