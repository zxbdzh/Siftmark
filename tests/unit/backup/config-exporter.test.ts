import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { ModelProfile } from '../../../src/ai/types';
import { readBlobBytes } from '../../../src/backup/blob';
import {
  createRedactedConfiguration,
  exportEncryptedCompleteConfiguration
} from '../../../src/backup/config-exporter';
import { decryptEncryptedContainer } from '../../../src/backup/encrypted-container';

const profile: ModelProfile = {
  id: 'deepseek',
  version: 'v2',
  name: 'DeepSeek',
  protocol: 'openai-chat',
  endpoint: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: 'sk-plain-secret',
  timeoutMs: 30_000,
  capabilities: ['classify', 'rename'],
  state: 'verified',
  verifiedAt: 1
};

describe('configuration export', () => {
  it('exports profile metadata and key presence without any key value', () => {
    const result = createRedactedConfiguration([profile], {
      appearance: { theme: 'dark' },
      nested: { api_key: 'nested-secret', keep: true },
      apiKey_deepseek: 'legacy-secret'
    });

    expect(result.profiles).toEqual([
      {
        id: 'deepseek',
        name: 'DeepSeek',
        protocol: 'openai-chat',
        endpoint: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        timeoutMs: 30_000,
        capabilities: ['classify', 'rename'],
        hasApiKey: true
      }
    ]);
    expect(result.settings).toEqual({
      appearance: { theme: 'dark' },
      nested: { keep: true }
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('places complete settings inside an encrypted ZIP without plaintext key bytes', async () => {
    const archive = await exportEncryptedCompleteConfiguration(
      { profiles: [profile], settings: { activeProfile: 'deepseek' } },
      'strong password'
    );
    const encryptedBytes = await readBlobBytes(archive);

    expect(
      containsBytes(encryptedBytes, new TextEncoder().encode(profile.apiKey))
    ).toBe(false);
    const zipBytes = await decryptEncryptedContainer(
      encryptedBytes,
      'strong password'
    );
    const zip = await JSZip.loadAsync(zipBytes);
    const configuration = JSON.parse(
      await zip.file('configuration.json')!.async('text')
    );
    expect(configuration.profiles[0].apiKey).toBe(profile.apiKey);
    expect(configuration.settings).toEqual({ activeProfile: 'deepseek' });
  });
});

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  return haystack.some((_, start) =>
    needle.every((byte, offset) => haystack[start + offset] === byte)
  );
}
