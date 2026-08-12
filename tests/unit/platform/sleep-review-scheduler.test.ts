import { describe, expect, it, vi } from 'vitest';
import {
  ChromeSleepReviewScheduler,
  SLEEP_REVIEW_ALARM,
  SLEEP_REVIEW_POLL_MINUTES
} from '../../../src/platform/chrome/sleep-review-scheduler';

describe('ChromeSleepReviewScheduler', () => {
  it('restores a five-minute alarm and immediately reviews an already-idle browser', async () => {
    const dependencies = createDependencies();
    dependencies.idle.queryState.mockResolvedValue('idle');
    const scheduler = new ChromeSleepReviewScheduler(dependencies);

    await scheduler.configure('startup');

    expect(dependencies.idle.setDetectionInterval).toHaveBeenCalledWith(15 * 60);
    expect(dependencies.alarms.create).toHaveBeenCalledWith(
      SLEEP_REVIEW_ALARM,
      {
        delayInMinutes: SLEEP_REVIEW_POLL_MINUTES,
        periodInMinutes: SLEEP_REVIEW_POLL_MINUTES
      }
    );
    expect(dependencies.review).toHaveBeenCalledWith('startup');
  });

  it('does not reset an existing alarm when the service worker restarts', async () => {
    const dependencies = createDependencies();
    dependencies.alarms.get.mockResolvedValue({
      name: SLEEP_REVIEW_ALARM,
      periodInMinutes: SLEEP_REVIEW_POLL_MINUTES
    });
    const scheduler = new ChromeSleepReviewScheduler(dependencies);

    await scheduler.configure('startup');

    expect(dependencies.alarms.create).not.toHaveBeenCalled();
  });

  it('runs from idle events and uses the alarm only while the browser is idle', async () => {
    const dependencies = createDependencies();
    const scheduler = new ChromeSleepReviewScheduler(dependencies);

    await scheduler.handleIdleState('idle');
    expect(dependencies.review).toHaveBeenLastCalledWith('idle');

    dependencies.idle.queryState.mockResolvedValueOnce('active');
    await scheduler.handleAlarm({ name: SLEEP_REVIEW_ALARM });
    expect(dependencies.review).toHaveBeenCalledTimes(1);

    dependencies.idle.queryState.mockResolvedValueOnce('locked');
    await scheduler.handleAlarm({ name: SLEEP_REVIEW_ALARM });
    expect(dependencies.review).toHaveBeenLastCalledWith('alarm');
  });

  it('clears the compensation alarm when automatic review is disabled', async () => {
    const dependencies = createDependencies();
    dependencies.settings.getSleepReviewSettings.mockResolvedValue({
      enabled: false,
      idleMinutes: 15,
      batchSize: 8
    });
    const scheduler = new ChromeSleepReviewScheduler(dependencies);

    await scheduler.configure('settings');

    expect(dependencies.alarms.clear).toHaveBeenCalledWith(SLEEP_REVIEW_ALARM);
    expect(dependencies.review).not.toHaveBeenCalled();
  });
});

function createDependencies() {
  return {
    settings: {
      getSleepReviewSettings: vi.fn().mockResolvedValue({
        enabled: true,
        idleMinutes: 15,
        batchSize: 8
      })
    },
    idle: {
      setDetectionInterval: vi.fn(),
      queryState: vi.fn().mockResolvedValue('active')
    },
    alarms: {
      get: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(true)
    },
    review: vi.fn().mockResolvedValue(undefined)
  };
}
