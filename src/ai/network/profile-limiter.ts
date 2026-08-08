import { ProviderError } from './errors';

interface QueueItem<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class ProfileLimiter {
  private readonly active = new Map<string, number>();
  private readonly queues = new Map<string, QueueItem<unknown>[]>();

  constructor(private readonly concurrency = 2, private readonly delay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  schedule<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queue = this.queues.get(profileId) ?? [];
      queue.push({ operation, resolve, reject } as QueueItem<unknown>);
      this.queues.set(profileId, queue);
      this.drain(profileId);
    });
  }

  private drain(profileId: string): void {
    const queue = this.queues.get(profileId) ?? [];
    while ((this.active.get(profileId) ?? 0) < this.concurrency && queue.length > 0) {
      const item = queue.shift()!;
      this.active.set(profileId, (this.active.get(profileId) ?? 0) + 1);
      void this.runWithRetry(item.operation).then(item.resolve, item.reject).finally(() => {
        this.active.set(profileId, (this.active.get(profileId) ?? 1) - 1);
        this.drain(profileId);
      });
    }
  }

  private async runWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= 2 || !isRetryable(error)) throw error;
        const retryAfter = error instanceof ProviderError ? error.retryAfterMs : undefined;
        await this.delay(Math.min(30_000, retryAfter ?? 250 * 2 ** attempt));
      }
    }
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && ['network', 'rate-limit', 'provider'].includes(error.kind);
}
