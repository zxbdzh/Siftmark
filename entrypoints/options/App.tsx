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
import { DexieMetadataRepository } from '../../src/storage/metadata-repository';
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
import { ChromeOnboardingStore } from '../../src/onboarding/onboarding-store';
import { OnboardingWizard } from '../../src/ui/onboarding/OnboardingWizard';
import { PermissionStep } from '../../src/ui/onboarding/PermissionStep';
import { SpecialFoldersStep } from '../../src/ui/onboarding/SpecialFoldersStep';
import { FloatingButtonStep } from '../../src/ui/onboarding/FloatingButtonStep';
import { ModelStep } from '../../src/ui/onboarding/ModelStep';
import { MigrationStep } from '../../src/ui/onboarding/MigrationStep';
import { ScanStep } from '../../src/ui/onboarding/ScanStep';
import { ResetService } from '../../src/settings/reset-service';
import { ResetSection } from '../../src/ui/options/ResetSection';

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
  const onboardingStore = useMemo(
    () => new ChromeOnboardingStore(browser.storage.local),
    []
  );
  const resetService = useMemo(
    () => new ResetService(database, browser.storage.local),
    [database]
  );
  const metadata = useMemo(
    () => new DexieMetadataRepository(database),
    [database]
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
  const [onboardingStatus, setOnboardingStatus] = useState<
    'loading' | 'active' | 'completed'
  >('loading');
  useEffect(() => {
    void Promise.all([
      hydrateTheme(settings),
      usage.list().then(setMetrics),
      onboardingStore
        .load()
        .then((state) =>
          setOnboardingStatus(
            state.status === 'completed' ? 'completed' : 'active'
          )
        )
    ]);
  }, [onboardingStore, settings, usage]);
  const backupCenter = (
    <BackupCenter
      bookmarks={bookmarks}
      database={database}
      profiles={profiles}
      appVersion="0.1.0"
    />
  );
  if (onboardingStatus === 'loading') {
    return (
      <main>
        <header>
          <strong className="brand-type">Siftmark</strong>
          <h1>设置</h1>
        </header>
        <p>正在读取首次设置…</p>
      </main>
    );
  }
  if (onboardingStatus === 'active') {
    return (
      <main>
        <header>
          <strong className="brand-type">Siftmark</strong>
          <h1>首次设置</h1>
        </header>
        <OnboardingWizard
          store={onboardingStore}
          onComplete={() => setOnboardingStatus('completed')}
          steps={{
            'permissions-privacy': <PermissionStep />,
            'special-folders': (
              <SpecialFoldersStep settings={settings} bookmarks={bookmarks} />
            ),
            'floating-button': <FloatingButtonStep />,
            model: (
              <ModelStep>
                <ModelProfilesSection
                  repository={profiles}
                  service={profileService}
                />
              </ModelStep>
            ),
            migration: <MigrationStep>{backupCenter}</MigrationStep>,
            'read-only-scan': (
              <ScanStep bookmarks={bookmarks} metadata={metadata} />
            )
          }}
        />
      </main>
    );
  }
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
      {backupCenter}
      <IncognitoSection />
      <AiUsageSection
        metrics={metrics}
        repository={usage}
        onClear={() => setMetrics([])}
      />
      <ResetSection
        service={resetService}
        onBackup={() =>
          document
            .getElementById('backup-center')
            ?.scrollIntoView({ behavior: 'smooth' })
        }
        onResetAll={() => setOnboardingStatus('active')}
      />
    </main>
  );
}
