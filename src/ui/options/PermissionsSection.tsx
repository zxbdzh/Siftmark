import { useEffect, useState } from 'react';

export function PermissionsSection() {
  const [notifications, setNotifications] = useState(false);
  const [hostAccess, setHostAccess] = useState(false);
  const [floating, setFloating] = useState(false);
  useEffect(() => { void Promise.all([browser.permissions.contains({ permissions: ['notifications'] }), browser.permissions.contains({ origins: ['<all_urls>'] }), browser.storage.local.get('siftmark.content.floating')]).then(([notificationGranted, hostGranted, storage]) => { setNotifications(notificationGranted); setHostAccess(hostGranted); setFloating(storage['siftmark.content.floating'] === true); }); }, []);
  const setNotificationPermission = async (checked: boolean) => {
    if (checked) setNotifications(await browser.permissions.request({ permissions: ['notifications'] }));
    else { await browser.permissions.remove({ permissions: ['notifications'] }); setNotifications(false); }
  };
  const clearHiddenDomains = async () => {
    const values = await browser.storage.local.get(null);
    const keys = Object.keys(values).filter((key) => key.startsWith('siftmark.content.hidden.'));
    if (keys.length > 0) await browser.storage.local.remove(keys);
  };
  return <section><h2>权限与通知</h2><p>网页访问权限用于按需读取页面内容和生成缩略图；撤销后本地书签管理仍可使用。</p><dl className="permission-status"><div><dt>网页访问</dt><dd>{hostAccess ? '已授权' : '未授权，页面分析与缩略图不可用'}</dd></div><div><dt>书签</dt><dd>已授权，用作唯一书签数据源</dd></div></dl><div className="settings-toggles"><label className="inline-control"><input type="checkbox" checked={notifications} onChange={(event) => void setNotificationPermission(event.target.checked)}/>后台任务汇总通知</label><label className="inline-control"><input type="checkbox" checked={floating} onChange={(event) => { setFloating(event.target.checked); void browser.storage.local.set({ 'siftmark.content.floating': event.target.checked }); }}/>网页悬浮保存按钮</label><button type="button" onClick={() => void clearHiddenDomains()}>重置已隐藏网站</button></div></section>;
}
