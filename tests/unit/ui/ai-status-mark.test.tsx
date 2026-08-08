import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiStatusMark } from '../../../src/ui/components/AiStatusMark';
import idle from '../../../assets/lottie/idle.json';
import analyzing from '../../../assets/lottie/analyzing.json';
import success from '../../../assets/lottie/success.json';
import paused from '../../../assets/lottie/paused.json';

describe('AiStatusMark', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses a static fallback when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<AiStatusMark state="analyzing" label="正在分析" />);
    expect(screen.getByRole('img', { name: '正在分析' })).toHaveAttribute('data-motion', 'static');
  });
  it('ships four local vector animations with nonzero bounds', () => {
    for (const animation of [idle, analyzing, success, paused]) {
      expect(animation).toMatchObject({ w: 64, h: 64 });
      expect(animation.layers.length).toBeGreaterThan(0);
      expect(animation.assets).toEqual([]);
    }
  });
});
