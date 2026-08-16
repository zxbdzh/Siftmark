import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/openai-chat-success.json';
import type { AiAdapter } from '../../../src/ai/adapters/adapter';
import { MeteredAiAdapter } from '../../../src/ai/adapters/metered-adapter';
import { ProfileLimitedAiAdapter } from '../../../src/ai/adapters/profile-limited-adapter';
import { createDefaultAiAdapterRegistry } from '../../../src/ai/create-adapter-registry';
import { ProviderError } from '../../../src/ai/network/errors';
import { ProfileLimiter } from '../../../src/ai/network/profile-limiter';
import type {
  AiAnalysisResult,
  ModelProfile
} from '../../../src/ai/types';

const profile: ModelProfile = {
  id: 'profile',
  version: 'v1',
  name: 'Profile',
  protocol: 'openai-chat',
  endpoint: 'https://api.test/v1',
  model: 'model',
  apiKey: 'key',
  timeoutMs: 1_000,
  capabilities: ['classify'],
  state: 'verified'
};

const context = {
  title: 'A',
  url: 'https://a.test',
  currentFolderPath: []
};

const analysis: AiAnalysisResult = {
  folderPath: ['Reference'],
  title: 'A',
  tags: [],
  summary: '',
  confidence: 'high',
  reason: 'Matched'
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProfileLimitedAiAdapter', () => {
  it('limits one profile version to two concurrent operations', async () => {
    const pending: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const analyze = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return analysis;
    });
    const adapter = new ProfileLimitedAiAdapter(
      createAdapter(analyze),
      new ProfileLimiter(2, async () => undefined)
    );

    const operations = [
      adapter.analyze(profile, context, new AbortController().signal),
      adapter.analyze(profile, context, new AbortController().signal),
      adapter.analyze(profile, context, new AbortController().signal)
    ];

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
    pending.shift()?.();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(3));
    pending.splice(0).forEach((resolve) => resolve());
    await expect(Promise.all(operations)).resolves.toHaveLength(3);
    expect(peak).toBe(2);
  });

  it('uses profile version as part of the concurrency key', async () => {
    const pending: Array<() => void> = [];
    const analyze = vi.fn(
      () =>
        new Promise<AiAnalysisResult>((resolve) =>
          pending.push(() => resolve(analysis))
        )
    );
    const adapter = new ProfileLimitedAiAdapter(
      createAdapter(analyze),
      new ProfileLimiter(1, async () => undefined)
    );

    const operations = [
      adapter.analyze(profile, context, new AbortController().signal),
      adapter.analyze(
        { ...profile, version: 'v2' },
        context,
        new AbortController().signal
      )
    ];

    expect(analyze).toHaveBeenCalledTimes(2);
    pending.splice(0).forEach((resolve) => resolve());
    await expect(Promise.all(operations)).resolves.toHaveLength(2);
  });

  it('does not invoke the adapter for a pre-aborted operation', async () => {
    const analyze = vi.fn().mockResolvedValue(analysis);
    const adapter = new ProfileLimitedAiAdapter(
      createAdapter(analyze),
      new ProfileLimiter(2, async () => undefined)
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.analyze(profile, context, controller.signal)
    ).rejects.toMatchObject({ kind: 'abort' });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('meters every physical retry when composed outside MeteredAiAdapter', async () => {
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('network', 'offline'))
      .mockRejectedValueOnce(new ProviderError('provider', 'unavailable', 503))
      .mockResolvedValue(analysis);
    const add = vi.fn().mockResolvedValue(undefined);
    let requestId = 0;
    const metered = new MeteredAiAdapter(
      createAdapter(analyze),
      { add },
      () => 100,
      () => `request-${requestId += 1}`
    );
    const adapter = new ProfileLimitedAiAdapter(
      metered,
      new ProfileLimiter(2, async () => undefined)
    );

    await expect(
      adapter.analyze(profile, context, new AbortController().signal)
    ).resolves.toEqual(analysis);

    expect(analyze).toHaveBeenCalledTimes(3);
    expect(add).toHaveBeenCalledTimes(3);
    expect(add.mock.calls.map(([metric]) => metric.status)).toEqual([
      'network',
      'provider',
      'success'
    ]);
  });

  it('uses the resilient outer wrapper in the default registry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 503,
          headers: { 'retry-after': '0' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);
    const add = vi.fn().mockResolvedValue(undefined);
    const adapter = createDefaultAiAdapterRegistry({ add }).get(
      'openai-chat'
    );

    await expect(
      adapter!.analyze(profile, context, new AbortController().signal)
    ).resolves.toMatchObject({ confidence: 'high' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.map(([metric]) => metric.status)).toEqual([
      'provider',
      'success'
    ]);
  });
});

function createAdapter(analyze: AiAdapter['analyze']): AiAdapter {
  return {
    protocol: 'openai-chat',
    testConnection: vi.fn().mockResolvedValue({
      authentication: true,
      text: true,
      structuredOutput: true,
      embedding: false
    }),
    analyze
  };
}
