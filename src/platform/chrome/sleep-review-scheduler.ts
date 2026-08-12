import type {
  ChromeSettingsRepository,
  SleepReviewTrigger
} from '../../settings/settings-repository';

export const SLEEP_REVIEW_ALARM = 'siftmark-sleep-review';
export const SLEEP_REVIEW_POLL_MINUTES = 5;

type IdleState = 'active' | 'idle' | 'locked';

interface SleepReviewAlarm {
  name: string;
  periodInMinutes?: number;
}

export interface ChromeSleepReviewSchedulerDependencies {
  settings: Pick<ChromeSettingsRepository, 'getSleepReviewSettings'>;
  idle: {
    setDetectionInterval(seconds: number): void;
    queryState(seconds: number): Promise<IdleState>;
  };
  alarms: {
    get(name: string): Promise<SleepReviewAlarm | undefined>;
    create(
      name: string,
      alarmInfo: { delayInMinutes: number; periodInMinutes: number }
    ): Promise<void> | void;
    clear(name: string): Promise<boolean>;
  };
  review(trigger: SleepReviewTrigger): Promise<unknown>;
}

/**
 * Restores the MV3 wake-up path and compensates for idle transitions that
 * happened while the extension service worker was stopped.
 */
export class ChromeSleepReviewScheduler {
  constructor(
    private readonly dependencies: ChromeSleepReviewSchedulerDependencies
  ) {}

  async configure(
    trigger: Extract<SleepReviewTrigger, 'startup' | 'installed' | 'settings'>
  ): Promise<void> {
    const configuration =
      await this.dependencies.settings.getSleepReviewSettings();
    this.dependencies.idle.setDetectionInterval(
      configuration.idleMinutes * 60
    );
    if (!configuration.enabled) {
      await this.dependencies.alarms.clear(SLEEP_REVIEW_ALARM);
      return;
    }

    const alarm = await this.dependencies.alarms.get(SLEEP_REVIEW_ALARM);
    if (alarm?.periodInMinutes !== SLEEP_REVIEW_POLL_MINUTES)
      await this.dependencies.alarms.create(SLEEP_REVIEW_ALARM, {
        delayInMinutes: SLEEP_REVIEW_POLL_MINUTES,
        periodInMinutes: SLEEP_REVIEW_POLL_MINUTES
      });
    await this.reviewIfIdle(configuration.idleMinutes, trigger);
  }

  async handleIdleState(state: IdleState): Promise<void> {
    if (!isIdle(state)) return;
    const configuration =
      await this.dependencies.settings.getSleepReviewSettings();
    if (configuration.enabled) await this.dependencies.review('idle');
  }

  async handleAlarm(alarm: SleepReviewAlarm): Promise<void> {
    if (alarm.name !== SLEEP_REVIEW_ALARM) return;
    const configuration =
      await this.dependencies.settings.getSleepReviewSettings();
    if (!configuration.enabled) return;
    await this.reviewIfIdle(configuration.idleMinutes, 'alarm');
  }

  private async reviewIfIdle(
    idleMinutes: number,
    trigger: SleepReviewTrigger
  ): Promise<void> {
    const state = await this.dependencies.idle.queryState(idleMinutes * 60);
    if (isIdle(state)) await this.dependencies.review(trigger);
  }
}

function isIdle(state: IdleState): boolean {
  return state === 'idle' || state === 'locked';
}
