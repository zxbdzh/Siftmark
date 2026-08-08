import type { TaskRepository } from './task-repository';
import type { DurableTask, TaskHandler, TaskHandlerResult } from './types';

export class TaskRunner {
  private readonly handlers = new Map<string, TaskHandler>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly repository: TaskRepository, private readonly now: () => number = Date.now) {}

  register<TInput>(type: string, handler: TaskHandler<TInput>): void {
    this.handlers.set(type, handler as TaskHandler);
  }

  async runNext(): Promise<DurableTask | null> {
    const task = await this.repository.claimNext(this.now());
    if (!task) return null;
    const handler = this.handlers.get(task.type);
    if (!handler) {
      await this.repository.update(task.id, { state: 'failed', failed: task.failed + 1, updatedAt: this.now() });
      return { ...task, state: 'failed', failed: task.failed + 1 };
    }

    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    try {
      const result = await handler({
        task,
        signal: controller.signal,
        reportProgress: async (progress) => {
          await this.repository.update(task.id, { ...progress, updatedAt: this.now() });
        }
      });
      return this.finish(task, controller.signal.aborted ? { state: 'cancelled' } : result);
    } catch {
      const state = controller.signal.aborted ? 'cancelled' : 'failed';
      const result: TaskHandlerResult = { state, failed: state === 'failed' ? task.failed + 1 : task.failed };
      return this.finish(task, result);
    } finally {
      this.controllers.delete(task.id);
    }
  }

  async cancel(id: string): Promise<void> {
    this.controllers.get(id)?.abort();
    await this.repository.update(id, { state: 'cancelled', updatedAt: this.now() });
  }

  private async finish(task: DurableTask, result: TaskHandlerResult): Promise<DurableTask> {
    const finished: DurableTask = {
      ...task,
      state: result.state,
      completed: result.completed ?? task.completed,
      failed: result.failed ?? task.failed,
      updatedAt: this.now()
    };
    await this.repository.update(task.id, {
      state: finished.state,
      completed: finished.completed,
      failed: finished.failed,
      retryCount: finished.retryCount,
      updatedAt: finished.updatedAt
    });
    return finished;
  }
}
