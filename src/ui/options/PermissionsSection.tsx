import { useEffect, useState } from 'react';

export function PermissionsSection() {
  const [notifications, setNotifications] = useState(false);
  const [hostAccess, setHostAccess] = useState(false);
  useEffect(() => {
    void Promise.all([
      browser.permissions.contains({ permissions: ['notifications'] }),
      browser.permissions.contains({ origins: ['<all_urls>'] })
    ]).then(([notificationGranted, hostGranted]) => {
      setNotifications(notificationGranted);
      setHostAccess(hostGranted);
    });
  }, []);
  const setNotificationPermission = async (checked: boolean) => {
    if (checked)
      setNotifications(
        await browser.permissions.request({ permissions: ['notifications'] })
      );
    else {
      await browser.permissions.remove({ permissions: ['notifications'] });
      setNotifications(false);
    }
  };
  return (
    <section>
      <h2>权限与通知</h2>
      <p>网页访问权限用于按需读取当前页面内容和生成缩略图；本地书签树不会发送给模型。</p>
      <dl className="permission-status">
        <div><dt>网页访问</dt><dd>{hostAccess ? '已授权' : '未授权，页面分析与缩略图不可用'}</dd></div>
        <div><dt>书签</dt><dd>已授权，用作唯一书签数据源</dd></div>
      </dl>
      <div className="settings-toggles">
        <label className="inline-control">
          <input type="checkbox" checked={notifications} onChange={(event) => void setNotificationPermission(event.target.checked)} />
          后台任务汇总通知
        </label>
      </div>
    </section>
  );
}
