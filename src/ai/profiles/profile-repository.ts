import type { ModelProfile } from '../types';
import { parseModelProfile } from './model-profile';

const PROFILE_STORAGE_KEY = 'siftmark.ai.profiles.v1';

export interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ProfileRepository {
  list(): Promise<ModelProfile[]>;
  get(id: string, version?: string): Promise<ModelProfile | null>;
  put(profile: ModelProfile): Promise<ModelProfile>;
  remove(id: string, version: string): Promise<void>;
  exportRedacted(): Promise<Array<Omit<ModelProfile, 'apiKey'> & { apiKey: '' }>>;
}

export class ChromeProfileRepository implements ProfileRepository {
  constructor(private readonly storage: LocalStorageArea) {}

  async list(): Promise<ModelProfile[]> {
    const data = await this.storage.get(PROFILE_STORAGE_KEY);
    const stored = data[PROFILE_STORAGE_KEY];
    if (!Array.isArray(stored)) return [];
    return stored.map(parseModelProfile);
  }

  async get(id: string, version?: string): Promise<ModelProfile | null> {
    const matches = (await this.list()).filter((profile) => profile.id === id && (!version || profile.version === version));
    return matches.at(-1) ?? null;
  }

  async put(profile: ModelProfile): Promise<ModelProfile> {
    const validated = parseModelProfile(profile);
    const profiles = (await this.list()).filter((item) => item.id !== validated.id || item.version !== validated.version);
    profiles.push(validated);
    await this.storage.set({ [PROFILE_STORAGE_KEY]: profiles });
    return validated;
  }

  async remove(id: string, version: string): Promise<void> {
    const profiles = (await this.list()).filter((profile) => profile.id !== id || profile.version !== version);
    await this.storage.set({ [PROFILE_STORAGE_KEY]: profiles });
  }

  async exportRedacted(): Promise<Array<Omit<ModelProfile, 'apiKey'> & { apiKey: '' }>> {
    return (await this.list()).map((profile) => ({ ...profile, apiKey: '' }));
  }
}
