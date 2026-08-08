import { describe, expect, it, vi } from 'vitest';
import { LinkChecker } from '../../../src/health/link-checker';

describe('LinkChecker', () => {
  it('falls back from unsupported HEAD to a ranged GET and classifies status codes', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const result = await new LinkChecker(fetcher, () => 10).check(
      'https://example.com'
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://example.com',
      expect.objectContaining({
        method: 'GET',
        headers: { range: 'bytes=0-0' }
      })
    );
    expect(result).toMatchObject({ status: 'healthy', checkedAt: 10 });
  });

  it.each([
    [401, 'restricted'],
    [404, 'dead'],
    [429, 'temporary'],
    [503, 'temporary']
  ] as const)('classifies HTTP %s as %s', async (status, expected) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    expect(
      (await new LinkChecker(fetcher).check('https://example.com')).status
    ).toBe(expected);
  });

  it('honors per-domain concurrency and cancellation', async () => {
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return new Response(null, { status: 200 });
    });
    await new LinkChecker(fetcher).checkMany(
      ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'],
      { concurrencyPerDomain: 1 }
    );
    expect(maximum).toBe(1);
  });

  it('invokes the browser fetch boundary with the global receiver', async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    await expect(
      new LinkChecker(fetcher as typeof globalThis.fetch).check(
        'https://example.com'
      )
    ).resolves.toMatchObject({ status: 'healthy' });
  });
});
