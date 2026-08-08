import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type DensityPreference = 'comfortable' | 'compact';

interface ThemeState {
  theme: ThemePreference;
  density: DensityPreference;
  setTheme(theme: ThemePreference): void;
  setDensity(density: DensityPreference): void;
  apply(root?: HTMLElement): void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'system',
  density: 'comfortable',
  setTheme: (theme) => set({ theme }),
  setDensity: (density) => set({ density }),
  apply: (root = document.documentElement) => {
    const { theme, density } = get();
    const resolved = theme === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : theme === 'system' ? 'light' : theme;
    root.dataset.theme = resolved;
    root.dataset.density = density;
  }
}));
