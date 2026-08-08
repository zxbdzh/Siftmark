import type { AiAdapterRegistry } from '../adapter-registry';
import type { AiCapability, CapabilityProbe, ModelProfile } from '../types';
import type { ChromeSettingsRepository } from '../../settings/settings-repository';
import type { ProfileRepository } from './profile-repository';

export class ModelProfileService {
  constructor(private readonly profiles: ProfileRepository, private readonly adapters: AiAdapterRegistry, private readonly settings: ChromeSettingsRepository) {}

  async verify(profile: ModelProfile, signal = new AbortController().signal): Promise<{ profile: ModelProfile; probe: CapabilityProbe }> {
    const adapter = this.adapters.get(profile.protocol);
    if (!adapter) throw new Error('所选协议不可用');
    const probe = await adapter.testConnection(profile, signal);
    const requiresText = profile.capabilities.some((capability) => capability !== 'embed');
    const requiresEmbedding = profile.capabilities.includes('embed');
    if (!probe.authentication || (requiresText && (!probe.text || !probe.structuredOutput)) || (requiresEmbedding && !probe.embedding)) throw new Error('模型未通过所需能力验证');
    const verified = await this.profiles.put({ ...profile, state: 'verified', verifiedAt: Date.now() });
    return { profile: verified, probe };
  }

  async assign(profile: ModelProfile, capabilities: AiCapability[]): Promise<void> {
    if (profile.state !== 'verified') throw new Error('只能启用已验证的模型档案');
    const assignments = await this.settings.getProfileAssignments();
    for (const capability of capabilities) {
      if (!profile.capabilities.includes(capability)) throw new Error(`模型不支持 ${capability}`);
      assignments[capability] = `${profile.id}@${profile.version}`;
    }
    await this.settings.setProfileAssignments(assignments);
  }
}
