import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../../src/ai/network/errors';
import { ProfileLimiter } from '../../../src/ai/network/profile-limiter';

describe('ProfileLimiter', () => {
  it('retries rate limits at most twice', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('rate-limit', 'limited', 429, 1))
      .mockRejectedValueOnce(new ProviderError('rate-limit', 'limited', 429, 1))
      .mockResolvedValue('ok');
    const limiter = new ProfileLimiter(2, async () => undefined);
    await expect(limiter.schedule('p1', operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry authentication failures', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new ProviderError('authentication', 'bad key', 401));
    await expect(
      new ProfileLimiter(2, async () => undefined).schedule('p1', operation)
    ).rejects.toMatchObject({ kind: 'authentication' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each(['authorization', 'validation', 'abort', 'unknown-result'] as const)(
    'does not retry %s failures',
    async (kind) => {
      const operation = vi
        .fn()
        .mockRejectedValue(new ProviderError(kind, 'not retryable'));

      await expect(
        new ProfileLimiter(2, async () => undefined).schedule('p1', operation)
      ).rejects.toMatchObject({ kind });
      expect(operation).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['network', 'provider'] as const)(
    'retries %s failures at most twice',
    async (kind) => {
      const operation = vi
        .fn()
        .mockRejectedValue(new ProviderError(kind, 'retryable'));

      await expect(
        new ProfileLimiter(2, async () => undefined).schedule('p1', operation)
      ).rejects.toMatchObject({ kind });
      expect(operation).toHaveBeenCalledTimes(3);
    }
  );
  it('reports queued, rate-limit retry and resumed execution without changing retry bounds', async () => {
    const states = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError('rate-limit', 'limited', 429, 1000)
      )
      .mockResolvedValue('ok');
    await expect(
      new ProfileLimiter(2, async () => undefined).schedule(
        'p',
        operation,
        states
      )
    ).resolves.toBe('ok');
    expect(states.mock.calls.map(([state]) => state.status)).toEqual([
      'queued',
      'running',
      'retrying',
      'running'
    ]);
    expect(states).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterMs: 1000, reason: 'rate-limit' })
    );
  });
});
