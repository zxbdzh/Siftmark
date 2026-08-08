import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiStatusMark } from '../../../src/ui/components/AiStatusMark';

describe('AiStatusMark', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses a static fallback when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<AiStatusMark state="analyzing" label="正在分析" />);
    expect(screen.getByRole('img', { name: '正在分析' })).toHaveAttribute('data-motion', 'static');
  });
});
