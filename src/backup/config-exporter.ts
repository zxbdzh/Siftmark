import type { AiCapability, AiProtocol, ModelProfile } from '../ai/types';
import { parseModelProfile } from '../ai/profiles/model-profile';
import JSZip from 'jszip';
import { readBlobBytes } from './blob';
import {
  createEncryptedContainer,
  decryptEncryptedContainer
} from './encrypted-container';
import { stableStringify } from './native-exporter';
import { parseNativeBackup } from './native-importer';
import type { ImportGraph } from './types';

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

export async function parseEncryptedCompleteConfiguration(
  archive: Blob,
  password: string
): Promise<ImportGraph> {
  const encryptedBytes = await readBlobBytes(archive);
  const zipBytes = await decryptEncryptedContainer(encryptedBytes, password);
  encryptedBytes.fill(0);
  try {
    const zip = await JSZip.loadAsync(zipBytes);
    const configurationFile = zip.file('configuration.json');
    const nativeBackupFile = zip.file('native-backup.zip');
    if (!configurationFile || !nativeBackupFile) {
      throw new Error('invalid-complete-configuration');
    }
    const [configurationText, nativeBackupBytes] = await Promise.all([
      configurationFile.async('text'),
      nativeBackupFile.async('uint8array')
    ]);
    const configuration = parseCompleteConfiguration(configurationText);
    const graph = await parseNativeBackup(
      new Blob([Uint8Array.from(nativeBackupBytes).buffer], {
        type: 'application/zip'
      })
    );
    nativeBackupBytes.fill(0);
    return {
      ...graph,
      settings: {
        ...configuration.settings,
        'siftmark.ai.profiles.v1': configuration.profiles
      },
      keyPresence: 'encrypted'
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('invalid-'))
      throw error;
    throw new Error('invalid-complete-configuration');
  } finally {
    zipBytes.fill(0);
  }
}

function parseCompleteConfiguration(value: string): {
  profiles: ModelProfile[];
  settings: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('invalid-complete-configuration');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid-complete-configuration');
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.format !== 'siftmark-complete-configuration' ||
    record.version !== 1 ||
    !Array.isArray(record.profiles) ||
    !record.settings ||
    typeof record.settings !== 'object' ||
    Array.isArray(record.settings)
  ) {
    throw new Error('invalid-complete-configuration');
  }
  return {
    profiles: record.profiles.map(parseModelProfile),
    settings: record.settings as Record<string, unknown>
  };
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
