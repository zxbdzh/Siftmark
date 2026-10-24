import { describe, expect, it, vi } from 'vitest';
import { ModelProfileService } from '../../../src/ai/profiles/profile-service';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = {
  id: 'capture-model',
  version: 'v1',
  name: 'Capture model',
  protocol: 'openai-chat',
  endpoint: 'https://example.test/v1',
  model: 'model',
  apiKey: '',
  timeoutMs: 10_000,
  capabilities: ['classify'],
  state: 'verified'
};

describe('ModelProfileService', () => {
  it('stores a dedicated Agent assignment without replacing classification', async () => {
    const settings = {
      getProfileAssignments: vi
        .fn()
        .mockResolvedValue({ classify: 'general@v1' }),
      setProfileAssignments: vi.fn().mockResolvedValue(undefined)
    };
    const service = new ModelProfileService(
      {} as never,
      {} as never,
      settings as never
    );

    await service.assign(profile, ['agent']);

    expect(settings.setProfileAssignments).toHaveBeenCalledWith({
      classify: 'general@v1',
      agent: 'capture-model@v1'
    });
  });

  it('requires classification support for the Agent assignment', async () => {
    const settings = {
      getProfileAssignments: vi.fn().mockResolvedValue({}),
      setProfileAssignments: vi.fn()
    };
    const service = new ModelProfileService(
      {} as never,
      {} as never,
      settings as never
    );

    await expect(
      service.assign({ ...profile, capabilities: ['summarize'] }, ['agent'])
    ).rejects.toThrow('模型不支持 agent');
    expect(settings.setProfileAssignments).not.toHaveBeenCalled();
  });

  it('does not replace stored configuration when verification is cancelled before the probe returns', async () => {
    const controller = new AbortController();
    const profiles = { put: vi.fn() };
    const adapter = {
      testConnection: vi.fn(async () => {
        controller.abort();
        return {
          authentication: true,
          text: true,
          structuredOutput: true,
          embedding: false
        };
      })
    };
    const service = new ModelProfileService(
      profiles as never,
      { get: () => adapter } as never,
      {} as never
    );
    await expect(
      service.verify(profile, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(profiles.put).not.toHaveBeenCalled();
  });
});
