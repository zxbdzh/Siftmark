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
  it.each([
    'https://api.test/v1',
    'http://api.test/v1',
    'http://203.0.113.10:56005/v1',
    'http://192.168.1.10:8080/v1',
    'http://localhost:11434/v1',
    'http://[::1]:11434/v1'
  ])('allows HTTP(S) endpoint %s without rewriting it', (endpoint) => {
    expect(parseModelProfile(profile({ endpoint })).endpoint).toBe(endpoint);
  });
  it.each(['ftp://api.test/v1', 'file:///tmp/model', 'javascript:alert(1)', 'not-a-url'])(
    'rejects unsupported or invalid endpoint %s',
    (endpoint) => expect(() => parseModelProfile(profile({ endpoint }))).toThrow()
  );
});
