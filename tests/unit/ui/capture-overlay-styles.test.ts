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
