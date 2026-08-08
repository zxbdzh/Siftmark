import type { AiCapability, AiProtocol, ModelProfile } from '../ai/types';
import JSZip from 'jszip';
import { createEncryptedContainer } from './encrypted-container';
import { stableStringify } from './native-exporter';

export interface RedactedProfileConfiguration {
  id: string;
  name: string;
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  timeoutMs: number;
  capabilities: AiCapability[];
  hasApiKey: boolean;
}

export interface RedactedConfigurationV1 {
  format: 'siftmark-config';
  version: 1;
  exportedAt: string;
  profiles: RedactedProfileConfiguration[];
  settings: Record<string, unknown>;
}

export interface CompleteConfigurationInput {
  profiles: ModelProfile[];
  settings: Record<string, unknown>;
  nativeBackup?: Uint8Array;
  exportedAt?: Date;
}

export function createRedactedConfiguration(
  profiles: ModelProfile[],
  settings: Record<string, unknown>,
  exportedAt = new Date()
): RedactedConfigurationV1 {
  return {
    format: 'siftmark-config',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      endpoint: profile.endpoint,
      model: profile.model,
      timeoutMs: profile.timeoutMs,
      capabilities: [...profile.capabilities],
      hasApiKey: profile.apiKey.trim().length > 0
    })),
    settings: redactApiKeys(settings) as Record<string, unknown>
  };
}

export function exportRedactedConfiguration(
  profiles: ModelProfile[],
  settings: Record<string, unknown>
): Blob {
  return new Blob(
    [stableStringify(createRedactedConfiguration(profiles, settings))],
    {
      type: 'application/json'
    }
  );
}

export async function exportEncryptedCompleteConfiguration(
  input: CompleteConfigurationInput,
  password: string
): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    'configuration.json',
    stableStringify({
      format: 'siftmark-complete-configuration',
      version: 1,
      exportedAt: (input.exportedAt ?? new Date()).toISOString(),
      profiles: input.profiles,
      settings: input.settings
    })
  );
  if (input.nativeBackup) {
    zip.file('native-backup.zip', Uint8Array.from(input.nativeBackup).buffer);
  }
  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE'
  });
  try {
    const encrypted = await createEncryptedContainer(zipBytes, password);
    return new Blob([Uint8Array.from(encrypted).buffer], {
      type: 'application/x-siftmark-backup'
    });
  } finally {
    zipBytes.fill(0);
  }
}

function redactApiKeys(value: unknown, key = ''): unknown {
  if (/api.?key/i.test(key)) return undefined;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const redacted = redactApiKeys(item);
      return redacted === undefined ? [] : [redacted];
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([childKey, child]) => {
        const redacted = redactApiKeys(child, childKey);
        return redacted === undefined ? [] : [[childKey, redacted]];
      })
    );
  }
  return value;
}
