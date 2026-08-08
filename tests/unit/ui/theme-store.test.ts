import { beforeEach, describe, expect, it } from 'vitest';
import { useThemeStore } from '../../../src/ui/theme/theme-store';

describe('theme store', () => {
  beforeEach(() => useThemeStore.setState({ theme: 'system', density: 'comfortable' }));
  it('applies explicit theme and density to the root', () => {
    const root = document.createElement('div');
    useThemeStore.getState().setTheme('dark');
    useThemeStore.getState().setDensity('compact');
    useThemeStore.getState().apply(root);
    expect(root.dataset).toMatchObject({ theme: 'dark', density: 'compact' });
  });
});
