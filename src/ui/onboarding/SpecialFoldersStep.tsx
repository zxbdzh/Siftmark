import type { BookmarkRepository } from '../../bookmarks/ports';
import type { ChromeSettingsRepository } from '../../settings/settings-repository';
import { SpecialFoldersSection } from '../options/SpecialFoldersSection';

export function SpecialFoldersStep({
  settings,
  bookmarks
}: {
  settings: ChromeSettingsRepository;
  bookmarks: BookmarkRepository;
}) {
  return (
    <div className="onboarding-embedded-section">
      <SpecialFoldersSection settings={settings} bookmarks={bookmarks} />
    </div>
  );
}
