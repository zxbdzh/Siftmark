import type { AiCapability, ModelProfile } from '../types';
import { modelProfileKey } from './profile-key';

export function selectProfileForCapability(
  profiles: ModelProfile[],
  capability: AiCapability,
  preferredId?: string
): ModelProfile | null {
  const selectable = profiles.filter(
    (profile) =>
      profile.state === 'verified' && profile.capabilities.includes(capability)
  );
  if (preferredId)
    return (
      selectable.find(
        (profile) =>
          profile.id === preferredId ||
          modelProfileKey(profile) === preferredId
      ) ?? null
    );
  return selectable[0] ?? null;
}
