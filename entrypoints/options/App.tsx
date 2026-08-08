import { useEffect, useMemo, useState } from 'react';
import { createDefaultAiAdapterRegistry } from '../../src/ai/create-adapter-registry';
import type { RequestMetric } from '../../src/ai/network/request-metrics';
import { UsageRepository } from '../../src/ai/network/usage-repository';
import { ChromeProfileRepository } from '../../src/ai/profiles/profile-repository';
import { ModelProfileService } from '../../src/ai/profiles/profile-service';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import { ChromeSettingsRepository } from '../../src/settings/settings-repository';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { AiUsageSection } from '../../src/ui/options/AiUsageSection';
import { AppearanceSection } from '../../src/ui/options/AppearanceSection';
import { IncognitoSection } from '../../src/ui/options/IncognitoSection';
import { ModelProfilesSection } from '../../src/ui/options/ModelProfilesSection';
import { PermissionsSection } from '../../src/ui/options/PermissionsSection';
import { PromptRulesSection } from '../../src/ui/options/PromptRulesSection';
import { RulesSection } from '../../src/ui/options/RulesSection';
import { SpecialFoldersSection } from '../../src/ui/options/SpecialFoldersSection';
import { HealthAutomationSection } from '../../src/ui/options/HealthAutomationSection';
import { BackupCenter } from '../../src/ui/backup/BackupCenter';
import { hydrateTheme } from '../../src/ui/theme/theme-store';

export default function App() {
  const database = useMemo(() => openSiftmarkDatabase(), []);
  const profiles = useMemo(
    () => new ChromeProfileRepository(browser.storage.local),
    []
  );
  const settings = useMemo(
    () => new ChromeSettingsRepository(browser.storage.local),
    []
  );
  const bookmarks = useMemo(
    () =>
      new ChromeBookmarkRepository(
        browser.bookmarks as unknown as ChromeBookmarkApi
      ),
    []
  );
  const usage = useMemo(() => new UsageRepository(database), [database]);
  const profileService = useMemo(
    () =>
      new ModelProfileService(
        profiles,
        createDefaultAiAdapterRegistry(),
        settings
      ),
    [profiles, settings]
  );
  const [metrics, setMetrics] = useState<RequestMetric[]>([]);
  useEffect(() => {
    void Promise.all([hydrateTheme(settings), usage.list().then(setMetrics)]);
  }, [settings, usage]);
  return (
    <main>
      <header>
        <strong className="brand-type">Siftmark</strong>
        <h1>设置</h1>
      </header>
      <ModelProfilesSection repository={profiles} service={profileService} />
      <RulesSection repository={settings} bookmarks={bookmarks} />
      <PermissionsSection />
      <HealthAutomationSection bookmarks={bookmarks} />
      <AppearanceSection repository={settings} />
      <SpecialFoldersSection settings={settings} bookmarks={bookmarks} />
      <PromptRulesSection repository={settings} />
      <BackupCenter
        bookmarks={bookmarks}
        database={database}
        appVersion="0.1.0"
      />
      <IncognitoSection />
      <AiUsageSection
        metrics={metrics}
        repository={usage}
        onClear={() => setMetrics([])}
      />
    </main>
  );
}
