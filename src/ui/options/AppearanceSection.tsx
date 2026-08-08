import type { ChromeSettingsRepository } from '../../settings/settings-repository';
import { useThemeStore, type DensityPreference, type ThemePreference } from '../theme/theme-store';

export function AppearanceSection({ repository }: { repository?: ChromeSettingsRepository }) {
  const theme = useThemeStore((state) => state.theme);
  const density = useThemeStore((state) => state.density);
  const update = (next: { theme: ThemePreference; density: DensityPreference }) => {
    useThemeStore.setState(next);
    useThemeStore.getState().apply();
    void repository?.setAppearance(next);
  };
  return <section><h2>外观</h2><div className="settings-grid"><label>主题<select value={theme} onChange={(event) => update({ theme: event.target.value as ThemePreference, density })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>密度<select value={density} onChange={(event) => update({ theme, density: event.target.value as DensityPreference })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label></div></section>;
}
