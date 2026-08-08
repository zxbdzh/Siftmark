import { openSiftmarkDatabase } from '../src/storage/database';
import { DexieTaskRepository } from '../src/tasks/task-repository';
import { recoverInterruptedTasks } from '../src/tasks/task-recovery';
import { TaskRunner } from '../src/tasks/task-runner';

const TASK_WAKE_ALARM = 'siftmark-task-wake';

export default defineBackground(() => {
  const database = openSiftmarkDatabase();
  const tasks = new DexieTaskRepository(database);
  const runner = new TaskRunner(tasks);

  const processTasks = async () => {
    await recoverInterruptedTasks(tasks, Date.now());
    await runner.runNext();
  };

  void processTasks();
  browser.runtime.onInstalled.addListener(() => {
    console.info('Siftmark installed');
    void browser.alarms.create(TASK_WAKE_ALARM, { periodInMinutes: 1 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TASK_WAKE_ALARM) void runner.runNext();
  });
});
