import type { BrowserNotificationPort } from '../../notifications/notification-service';
import type { BrowserTaskSummary } from '../../notifications/types';

interface PermissionApi { contains(permissions: { permissions: string[] }): Promise<boolean> }
interface NotificationApi { create(id: string, options: { type: 'basic'; iconUrl: string; title: string; message: string }): Promise<string> | string }

export class ChromeBrowserNotifications implements BrowserNotificationPort {
  constructor(private readonly permissions: PermissionApi, private readonly notifications: NotificationApi, private readonly iconUrl: string) {}

  async showTaskSummary(summary: BrowserTaskSummary): Promise<boolean> {
    if (!await this.permissions.contains({ permissions: ['notifications'] })) return false;
    const state = summary.state === 'succeeded' ? '已完成' : summary.state === 'paused' ? '已暂停' : '失败';
    await this.notifications.create(crypto.randomUUID(), { type: 'basic', iconUrl: this.iconUrl, title: 'Siftmark 后台任务', message: `${summary.count} 个项目${state}` });
    return true;
  }
}
