import type { BrowserTaskSummary } from './types';
import type { AppNotification, NotificationType } from './types';
import { NotificationRepository } from './notification-repository';

export interface BrowserNotificationPort { showTaskSummary(summary: BrowserTaskSummary): Promise<boolean> }

export class NotificationService {
  constructor(private readonly repository: NotificationRepository, private readonly browserNotifications?: BrowserNotificationPort, private readonly now: () => number = Date.now, private readonly createId: () => string = () => crypto.randomUUID()) {}

  async notify(input: { type: NotificationType; title: string; message: string; details?: string; taskId?: string; browserSummary?: BrowserTaskSummary }): Promise<AppNotification> {
    const notification: AppNotification = { id: this.createId(), type: input.type, title: input.title, message: input.message, details: input.details, taskId: input.taskId, read: false, createdAt: this.now() };
    await this.repository.put(notification);
    await this.repository.enforceRetention(this.now());
    if (input.browserSummary) await this.browserNotifications?.showTaskSummary(input.browserSummary);
    return notification;
  }
}
