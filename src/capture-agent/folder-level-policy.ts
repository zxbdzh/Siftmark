import { smartBookmarkFolderLevelBounds } from '../settings/settings-repository';
import type { CaptureDestination } from './types';

const LEGACY_AUTOMATIC_LEVEL_LIMIT = 1;
const LEGACY_EXPLICIT_LEVEL_LIMIT = 3;

/**
 * Reads the immutable limit captured with a plan. Legacy sessions retain the
 * behavior that was in force when they were created.
 */
export function getCaptureNewFolderLevelLimit(
  destination: Pick<
    CaptureDestination,
    'creationSource' | 'maxNewFolderLevels'
  >
): number {
  const configured = destination.maxNewFolderLevels;
  if (typeof configured === 'number' && Number.isFinite(configured))
    return Math.min(
      smartBookmarkFolderLevelBounds.max,
      Math.max(0, Math.floor(configured))
    );
  return destination.creationSource === 'explicit-user'
    ? LEGACY_EXPLICIT_LEVEL_LIMIT
    : LEGACY_AUTOMATIC_LEVEL_LIMIT;
}
