export type TaskState = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';

export interface DurableTask<TInput = unknown> {
  id: string;
  type: string;
  state: TaskState;
  input: TInput;
  profileVersion?: string;
  completed: number;
  failed: number;
  retryCount: number;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskProgress {
  completed: number;
  failed: number;
}

export interface TaskHandlerContext<TInput = unknown> {
  task: DurableTask<TInput>;
  signal: AbortSignal;
  reportProgress(progress: TaskProgress): Promise<void>;
}

export interface TaskHandlerResult {
  state: Extract<TaskState, 'succeeded' | 'failed' | 'paused' | 'unknown' | 'cancelled'>;
  completed?: number;
  failed?: number;
}

export type TaskHandler<TInput = unknown> = (context: TaskHandlerContext<TInput>) => Promise<TaskHandlerResult>;
