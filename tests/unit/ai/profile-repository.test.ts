import { describe, expect, it, vi } from 'vitest';
import { ChromeProfileRepository } from '../../../src/ai/profiles/profile-repository';
import type { ModelProfile } from '../../../src/ai/types';

describe('ChromeProfileRepository', () => {
  it('stores keys locally and redacts them for export', async () => {
    let data: Record<string, unknown> = {};
    const storage = { get: vi.fn(async () => data), set: vi.fn(async (items) => { data = { ...data, ...items }; }) };
    const repository = new ChromeProfileRepository(storage);
    const profile: ModelProfile = { id: 'p1', version: 'v1', name: 'P', protocol: 'openai-chat', endpoint: 'https://api.test/v1', model: 'm', apiKey: 'secret', timeoutMs: 30_000, capabilities: ['classify'], state: 'verified' };
    await repository.put(profile);
    expect((await repository.get('p1'))?.apiKey).toBe('secret');
    expect((await repository.exportRedacted())[0]?.apiKey).toBe('');
  });
});
