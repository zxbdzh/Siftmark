export type NotificationType = 'task-succeeded' | 'task-paused' | 'task-failed' | 'health-summary' | 'info';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  details?: string;
  read: boolean;
  createdAt: number;
  taskId?: string;
}

export interface BrowserTaskSummary {
  state: 'succeeded' | 'paused' | 'failed';
  count: number;
}
