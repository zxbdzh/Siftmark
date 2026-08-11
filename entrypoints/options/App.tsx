import {
  ArchiveRestore,
  BarChart3,
  BookmarkCheck,
  BookOpen,
  Clock3,
  Info,
  Settings2,
  ShieldOff,
  Sparkles
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { createDefaultAiAdapterRegistry } from '../../src/ai/create-adapter-registry';
import type { RequestMetric } from '../../src/ai/network/request-metrics';
import { UsageRepository } from '../../src/ai/network/usage-repository';
import { ChromeProfileRepository } from '../../src/ai/profiles/profile-repository';
import { ModelProfileService } from '../../src/ai/profiles/profile-service';
import { DexieCapturePreferenceRepository } from '../../src/capture-agent';
import { ChromeSmartBookmarkHistoryRepository } from '../../src/bookmarks/history-repository';
import { ChromeBookmarkRepository } from '../../src/platform/chrome/bookmarks-adapter';
import type { ChromeBookmarkApi } from '../../src/platform/chrome/chrome-types';
import { ChromeSettingsRepository } from '../../src/settings/settings-repository';
import { ResetService } from '../../src/settings/reset-service';
import { openSiftmarkDatabase } from '../../src/storage/database';
import { BackupCenter } from '../../src/ui/backup/BackupCenter';
import { AiUsageSection } from '../../src/ui/options/AiUsageSection';
import { AppearanceSection } from '../../src/ui/options/AppearanceSection';
import { BlockedDomainsSection } from '../../src/ui/options/BlockedDomainsSection';
import { BookmarkPreferencesSection } from '../../src/ui/options/BookmarkPreferencesSection';
import { CapturePreferencesSection } from '../../src/ui/options/CapturePreferencesSection';
import { HealthAutomationSection } from '../../src/ui/options/HealthAutomationSection';
import { IncognitoSection } from '../../src/ui/options/IncognitoSection';
import { ModelProfilesSection } from '../../src/ui/options/ModelProfilesSection';
import { PermissionsSection } from '../../src/ui/options/PermissionsSection';
import { PromptRulesSection } from '../../src/ui/options/PromptRulesSection';
import { ResetSection } from '../../src/ui/options/ResetSection';
import { RulesSection } from '../../src/ui/options/RulesSection';
import { SmartBookmarkHistorySection } from '../../src/ui/options/SmartBookmarkHistorySection';
import { SpecialFoldersSection } from '../../src/ui/options/SpecialFoldersSection';
import { hydrateTheme } from '../../src/ui/theme/theme-store';

type PageId = 'settings' | 'backup' | 'blocked' | 'history' | 'usage' | 'about';

const navigation = [
  { id: 'settings', label: '设置', icon: Settings2 },
  { id: 'backup', label: '书签备份', icon: ArchiveRestore },
  { id: 'blocked', label: '屏蔽规则', icon: ShieldOff },
  { id: 'history', label: '历史记录', icon: Clock3 },
  { id: 'usage', label: '使用统计', icon: BarChart3 },
  { id: 'about', label: '关于', icon: Info }
] satisfies Array<{ id: PageId; label: string; icon: typeof Settings2 }>;

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
  const capturePreferences = useMemo(
    () => new DexieCapturePreferenceRepository(database),
    [database]
  );
  const history = useMemo(
    () => new ChromeSmartBookmarkHistoryRepository(browser.storage.local),
    []
  );
  const resetService = useMemo(
    () => new ResetService(database, browser.storage.local),
    [database]
  );
  const profileService = useMemo(
    () =>
      new ModelProfileService(
        profiles,
        createDefaultAiAdapterRegistry(usage),
        settings
      ),
    [profiles, settings, usage]
  );
  const [page, setPage] = useState<PageId>(pageFromHash());
  const [metrics, setMetrics] = useState<RequestMetric[]>([]);

  useEffect(() => {
    void hydrateTheme(settings);
    const usageSubscription = liveQuery(() => usage.list()).subscribe({
      next: setMetrics
    });
    const handleHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      usageSubscription.unsubscribe();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [settings, usage]);

  const activeLabel = navigation.find((item) => item.id === page)?.label ?? '设置';
  const openPage = (next: PageId) => {
    window.location.hash = next;
    setPage(next);
    document.querySelector('.settings-main')?.scrollTo({ top: 0 });
  };

  return (
    <div className="options-shell">
      <aside className="settings-sidebar">
        <div className="settings-brand">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <div>
            <strong className="brand-type">Siftmark</strong>
            <small>智能书签助手</small>
          </div>
        </div>
        <nav aria-label="设置导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </a>
            );
          })}
        </nav>
        <button
          type="button"
          className="manager-link"
          onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/manager.html') })}
        >
          <BookOpen size={17} />
          打开书签管理器
        </button>
      </aside>

      <main className="settings-main">
        <header className="settings-topbar">
          <div>
            <span>Siftmark</span>
            <h1>{activeLabel}</h1>
          </div>
          {page === 'settings' ? (
            <span className="topbar-status"><BookmarkCheck size={16} /> 一键智能收藏</span>
          ) : null}
        </header>
        <div className="settings-content">
          {page === 'settings' ? (
            <>
              <ModelProfilesSection repository={profiles} service={profileService} />
              <BookmarkPreferencesSection repository={settings} />
              <CapturePreferencesSection repository={capturePreferences} />
              <AppearanceSection repository={settings} />
              <PermissionsSection />
              <SpecialFoldersSection settings={settings} bookmarks={bookmarks} />
              <PromptRulesSection repository={settings} />
              <HealthAutomationSection bookmarks={bookmarks} />
              <IncognitoSection />
              <ResetSection
                service={resetService}
                onBackup={() => openPage('backup')}
                onResetAll={() => window.location.reload()}
              />
            </>
          ) : null}
          {page === 'backup' ? (
            <BackupCenter
              bookmarks={bookmarks}
              database={database}
              profiles={profiles}
              appVersion={browser.runtime.getManifest().version}
            />
          ) : null}
          {page === 'blocked' ? (
            <>
              <BlockedDomainsSection />
              <RulesSection repository={settings} bookmarks={bookmarks} />
            </>
          ) : null}
          {page === 'history' ? (
            <SmartBookmarkHistorySection repository={history} />
          ) : null}
          {page === 'usage' ? (
            <AiUsageSection
              metrics={metrics}
              repository={usage}
              onClear={() => setMetrics([])}
            />
          ) : null}
          {page === 'about' ? <AboutSection /> : null}
        </div>
      </main>
    </div>
  );
}

function pageFromHash(): PageId {
  const value = window.location.hash.slice(1);
  return navigation.some((item) => item.id === value)
    ? (value as PageId)
    : 'settings';
}

function AboutSection() {
  return (
    <section className="about-section">
      <div className="about-brand"><Sparkles size={24} /></div>
      <h2>Siftmark</h2>
      <p>版本 {browser.runtime.getManifest().version}</p>
      <p>
        Siftmark 使用你配置的 AI 服务分析当前网页，并直接整理到浏览器书签中。
        API Key、收藏历史和使用记录保存在浏览器本地。
      </p>
      <dl>
        <div><dt>核心能力</dt><dd>智能分类、重命名、批量整理、备份与恢复</dd></div>
        <div><dt>数据位置</dt><dd>浏览器扩展本地存储与书签数据库</dd></div>
        <div><dt>网络请求</dt><dd>仅发送到你在“设置”中配置的模型服务</dd></div>
      </dl>
    </section>
  );
}
