import type { SiftmarkDatabase } from '../storage/database';
import type { DurableTask, TaskState } from './types';

export interface TaskRepository {
  get(id: string): Promise<DurableTask | null>;
  put(task: DurableTask): Promise<void>;
  listByState(states: TaskState[]): Promise<DurableTask[]>;
  claimNext(now: number): Promise<DurableTask | null>;
  update(id: string, patch: Partial<DurableTask>): Promise<void>;
}

export class DexieTaskRepository implements TaskRepository {
  constructor(private readonly db: SiftmarkDatabase) {}

  get(id: string): Promise<DurableTask | null> {
    return this.db.tasks.get(id).then((value) => value ?? null);
  }

  async put(task: DurableTask): Promise<void> {
    await this.db.tasks.put(task);
  }

  async listByState(states: TaskState[]): Promise<DurableTask[]> {
    if (states.length === 0) return [];
    return this.db.tasks.where('state').anyOf(states).toArray();
  }

  async claimNext(now: number): Promise<DurableTask | null> {
    return this.db.transaction('rw', this.db.tasks, async () => {
      const queued = await this.db.tasks.where('state').equals('queued').sortBy('createdAt');
      const task = queued[0];
      if (!task) return null;
      const running: DurableTask = { ...task, state: 'running', updatedAt: now };
      await this.db.tasks.put(running);
      return running;
    });
  }

  async update(id: string, patch: Partial<DurableTask>): Promise<void> {
    await this.db.tasks.update(id, patch);
  }
}
