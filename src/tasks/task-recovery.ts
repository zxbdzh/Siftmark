import type { TaskRepository } from './task-repository';

export async function recoverInterruptedTasks(
  repository: TaskRepository,
  now: number,
  isNonIdempotent: (type: string) => boolean = (type) => type === 'ai-request'
): Promise<number> {
  const running = await repository.listByState(['running']);
  for (const task of running) {
    await repository.update(task.id, {
      state: isNonIdempotent(task.type) ? 'unknown' : 'queued',
      updatedAt: now
    });
  }
  return running.length;
}
