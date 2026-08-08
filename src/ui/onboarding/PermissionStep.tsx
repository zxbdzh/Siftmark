import { Bell, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PermissionStep() {
  const [hostAccess, setHostAccess] = useState(false);
  const [notifications, setNotifications] = useState(false);
  useEffect(() => {
    void Promise.all([
      browser.permissions.contains({ origins: ['<all_urls>'] }),
      browser.permissions.contains({ permissions: ['notifications'] })
    ]).then(([host, notice]) => {
      setHostAccess(host);
      setNotifications(notice);
    });
  }, []);
  const requestNotifications = async () => {
    setNotifications(
      await browser.permissions.request({ permissions: ['notifications'] })
    );
  };
  return (
    <div className="onboarding-choice">
      <dl className="permission-status">
        <div>
          <dt>
            <ShieldCheck size={16} />
            书签与本地存储
          </dt>
          <dd>已授权</dd>
        </div>
        <div>
          <dt>网页访问</dt>
          <dd>{hostAccess ? '已授权' : '未授权'}</dd>
        </div>
        <div>
          <dt>后台通知</dt>
          <dd>{notifications ? '已授权' : '可选，默认关闭'}</dd>
        </div>
      </dl>
      {notifications ? null : (
        <button type="button" onClick={() => void requestNotifications()}>
          <Bell size={16} />
          授权任务通知
        </button>
      )}
      <p>数据保存在本机浏览器扩展空间；模型请求仅发送到用户配置的服务地址。</p>
    </div>
  );
}
