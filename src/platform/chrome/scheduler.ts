export const HEALTH_SCAN_ALARM = 'siftmark-health-scan';
export const HEALTH_SCHEDULE_STORAGE_KEY = 'siftmark.health.schedule.v1';

export interface HealthSchedule {
  enabled: boolean;
  cadence: 'weekly' | 'monthly';
  folderIds: string[];
}

interface AlarmApi {
  create(name: string, alarmInfo: { periodInMinutes: number }): Promise<void> | void;
  clear(name: string): Promise<boolean> | boolean;
  get(name: string): Promise<unknown | undefined>;
}

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class ChromeHealthScheduler {
  constructor(private readonly alarms: AlarmApi, private readonly storage: StorageArea) {}

  async getSchedule(): Promise<HealthSchedule> {
    const value = (await this.storage.get(HEALTH_SCHEDULE_STORAGE_KEY))[HEALTH_SCHEDULE_STORAGE_KEY];
    if (!isSchedule(value)) return { enabled: false, cadence: 'weekly', folderIds: [] };
    return value;
  }

  async configure(schedule: HealthSchedule): Promise<void> {
    await this.storage.set({ [HEALTH_SCHEDULE_STORAGE_KEY]: schedule });
    await this.alarms.clear(HEALTH_SCAN_ALARM);
    if (schedule.enabled) await this.alarms.create(HEALTH_SCAN_ALARM, { periodInMinutes: schedule.cadence === 'weekly' ? 7 * 24 * 60 : 30 * 24 * 60 });
  }

  async restore(): Promise<void> {
    const schedule = await this.getSchedule();
    if (schedule.enabled && !await this.alarms.get(HEALTH_SCAN_ALARM)) await this.alarms.create(HEALTH_SCAN_ALARM, { periodInMinutes: schedule.cadence === 'weekly' ? 7 * 24 * 60 : 30 * 24 * 60 });
  }
}

function isSchedule(value: unknown): value is HealthSchedule {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<HealthSchedule>;
  return typeof row.enabled === 'boolean' && (row.cadence === 'weekly' || row.cadence === 'monthly') && Array.isArray(row.folderIds) && row.folderIds.every((id) => typeof id === 'string');
}
