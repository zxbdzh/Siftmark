import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../../src/ai/network/errors';
import { ProfileLimiter } from '../../../src/ai/network/profile-limiter';

describe('ProfileLimiter', () => {
  it('retries rate limits at most twice', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new ProviderError('rate-limit', 'limited', 429, 1)).mockRejectedValueOnce(new ProviderError('rate-limit', 'limited', 429, 1)).mockResolvedValue('ok');
    const limiter = new ProfileLimiter(2, async () => undefined);
    await expect(limiter.schedule('p1', operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry authentication failures', async () => {
    const operation = vi.fn().mockRejectedValue(new ProviderError('authentication', 'bad key', 401));
    await expect(new ProfileLimiter(2, async () => undefined).schedule('p1', operation)).rejects.toMatchObject({ kind: 'authentication' });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
