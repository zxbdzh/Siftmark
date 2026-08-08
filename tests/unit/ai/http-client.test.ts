import { describe, expect, it, vi } from 'vitest';
import { postProviderJson } from '../../../src/ai/network/http-client';

describe('postProviderJson', () => {
  it.each([[401, 'authentication'], [403, 'authorization'], [429, 'rate-limit'], [500, 'provider']] as const)('maps HTTP %i to %s', async (status, kind) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(postProviderJson({ url: 'https://api.test/v1?secret=x', headers: { authorization: 'Bearer secret' }, body: { secret: true }, signal: new AbortController().signal, timeoutMs: 1000, fetch })).rejects.toMatchObject({ kind });
    await expect(postProviderJson({ url: 'https://api.test/v1', headers: {}, body: {}, signal: new AbortController().signal, timeoutMs: 1000, fetch })).rejects.not.toHaveProperty('message', expect.stringContaining('secret'));
  });
});
