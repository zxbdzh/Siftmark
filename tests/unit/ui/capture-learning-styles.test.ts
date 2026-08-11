import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const optionsStyles = readFileSync(
  resolve(process.cwd(), 'entrypoints/options/options.css'),
  'utf8'
);

describe('sleep review motion styles', () => {
  it('uses transform-based direct manipulation for its controls', () => {
    expect(optionsStyles).toContain('.learning-toggle-track::after');
    expect(optionsStyles).toContain('transform: translateX(14px)');
    expect(optionsStyles).not.toContain(
      'background-position var(--learning-motion-control)'
    );
    expect(optionsStyles).not.toContain('transition: all');
  });

  it('provides motion, transparency, contrast, and forced-color fallbacks', () => {
    expect(optionsStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(optionsStyles).toContain(
      '@media (prefers-reduced-transparency: reduce)'
    );
    expect(optionsStyles).toContain('@media (prefers-contrast: more)');
    expect(optionsStyles).toContain('@media (forced-colors: active)');
  });

  it('uses the shared restrained motion language across settings', () => {
    expect(optionsStyles).toContain('--settings-accent: #0f766e');
    expect(optionsStyles).toContain(
      '.settings-content section button:active:not(:disabled)'
    );

    const hoverMedia = optionsStyles.indexOf(
      '@media (hover: hover) and (pointer: fine)'
    );
    expect(hoverMedia).toBeGreaterThan(-1);
    expect(optionsStyles.indexOf(':hover')).toBeGreaterThan(hoverMedia);
    expect(optionsStyles.slice(0, hoverMedia)).not.toContain(':hover');
  });
});
