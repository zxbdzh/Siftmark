import { afterEach, describe, expect, it, vi } from 'vitest';
import { postProviderJson } from '../../../src/ai/network/http-client';

afterEach(() => {
  vi.useRealTimers();
});

describe('postProviderJson', () => {
  it.each([[401, 'authentication'], [403, 'authorization'], [429, 'rate-limit'], [500, 'provider']] as const)('maps HTTP %i to %s', async (status, kind) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(postProviderJson({ url: 'https://api.test/v1?secret=x', headers: { authorization: 'Bearer secret' }, body: { secret: true }, signal: new AbortController().signal, timeoutMs: 1000, fetch })).rejects.toMatchObject({ kind });
    await expect(postProviderJson({ url: 'https://api.test/v1', headers: {}, body: {}, signal: new AbortController().signal, timeoutMs: 1000, fetch })).rejects.not.toHaveProperty('message', expect.stringContaining('secret'));
  });

  it('does not call fetch when the external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();

    await expect(
      postProviderJson({
        url: 'https://api.test/v1',
        headers: {},
        body: {},
        signal: controller.signal,
        timeoutMs: 1_000,
        fetch
      })
    ).rejects.toMatchObject({ kind: 'abort' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies an internal timeout as a retryable network failure', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const operation = postProviderJson({
      url: 'https://api.test/v1',
      headers: {},
      body: {},
      signal: new AbortController().signal,
      timeoutMs: 100,
      fetch
    });
    const expectation = expect(operation).rejects.toMatchObject({
      kind: 'network'
    });

    await vi.advanceTimersByTimeAsync(100);

    await expectation;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps an external abort non-retryable', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const operation = postProviderJson({
      url: 'https://api.test/v1',
      headers: {},
      body: {},
      signal: controller.signal,
      timeoutMs: 1_000,
      fetch
    });

    controller.abort();

    await expect(operation).rejects.toMatchObject({ kind: 'abort' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
