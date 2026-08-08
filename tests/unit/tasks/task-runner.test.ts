import { describe, expect, it, vi } from 'vitest';
import type { TaskRepository } from '../../../src/tasks/task-repository';
import { TaskRunner } from '../../../src/tasks/task-runner';
import type { DurableTask } from '../../../src/tasks/types';

const task: DurableTask = { id: 'task-1', type: 'local', state: 'running', input: {}, completed: 0, failed: 0, retryCount: 0, idempotencyKey: 'key', createdAt: 1, updatedAt: 1 };

describe('TaskRunner', () => {
  it('claims and completes a registered task', async () => {
    const repository = { claimNext: vi.fn().mockResolvedValue(task), update: vi.fn() } as unknown as TaskRepository;
    const runner = new TaskRunner(repository, () => 10);
    runner.register('local', async () => ({ state: 'succeeded', completed: 1 }));
    expect(await runner.runNext()).toMatchObject({ state: 'succeeded', completed: 1 });
    expect(repository.update).toHaveBeenCalledWith('task-1', expect.objectContaining({ state: 'succeeded' }));
  });

  it('marks tasks without a handler as failed', async () => {
    const repository = { claimNext: vi.fn().mockResolvedValue(task), update: vi.fn() } as unknown as TaskRepository;
    expect(await new TaskRunner(repository).runNext()).toMatchObject({ state: 'failed' });
  });
});
