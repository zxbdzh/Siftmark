import { describe, expect, it } from 'vitest';
import { captureOverlayStyles } from '../../../src/ui/content/capture-overlay.css';

describe('capture overlay motion', () => {
  it('keeps the Ctrl+D surface immediate while animating state changes', () => {
    const overlayRule = captureOverlayStyles.match(
      /\.siftmark-capture-overlay\s*\{([\s\S]*?)\n\}/
    )?.[1];

    expect(overlayRule).toBeDefined();
    expect(overlayRule).not.toContain('animation:');
    expect(overlayRule).toContain('transition:');
    expect(captureOverlayStyles).toContain(
      '.siftmark-button:active:not(:disabled)'
    );
    expect(captureOverlayStyles).toContain(
      '.siftmark-processing-trace > summary:active'
    );
  });

  it('keeps detailed analysis compact and user controlled', () => {
    expect(captureOverlayStyles).toContain(
      'max-height: min(620px, calc(100vh - 36px))'
    );
    expect(captureOverlayStyles).toContain(
      '.siftmark-processing-trace[open] .siftmark-trace-disclosure svg'
    );
    expect(captureOverlayStyles).toContain('max-height: min(300px, 38vh)');
    expect(captureOverlayStyles).toContain('overflow-y: auto');
  });

  it('provides motion, transparency, and contrast fallbacks', () => {
    expect(captureOverlayStyles).toContain(
      '@media (prefers-reduced-motion: reduce)'
    );
    expect(captureOverlayStyles).toContain(
      '@media (prefers-reduced-transparency: reduce)'
    );
    expect(captureOverlayStyles).toContain('@media (prefers-contrast: more)');
  });
});
