import type { ModelProfile } from '../types';

export function modelProfileKey(
  profile: Pick<ModelProfile, 'id' | 'version'>
): string {
  return `${profile.id}@${profile.version}`;
}
