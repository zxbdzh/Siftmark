import { describe, expect, it } from 'vitest';
import { parseModelProfile } from '../../../src/ai/profiles/model-profile';
import { selectProfileForCapability } from '../../../src/ai/profiles/profile-selector';
import type { ModelProfile } from '../../../src/ai/types';

const profile = (patch: Partial<ModelProfile> = {}): ModelProfile => ({ id: 'p1', version: 'v1', name: 'P', protocol: 'openai-chat', endpoint: 'https://api.test/v1', model: 'm', apiKey: 'secret', timeoutMs: 30_000, capabilities: ['classify'], state: 'verified', ...patch });

describe('model profiles', () => {
  it('selects only verified profiles with the requested capability', () => {
    expect(selectProfileForCapability([profile({ state: 'draft' }), profile({ id: 'p2' })], 'classify')?.id).toBe('p2');
  });
  it('allows loopback HTTP and clamps timeouts', () => {
    expect(parseModelProfile(profile({ endpoint: 'http://127.0.0.1:11434/v1', timeoutMs: 1 })).timeoutMs).toBe(5_000);
    expect(parseModelProfile(profile({ timeoutMs: 999_999 })).timeoutMs).toBe(120_000);
  });
  it('rejects remote HTTP endpoints', () => expect(() => parseModelProfile(profile({ endpoint: 'http://api.test/v1' }))).toThrow());
});
