import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sidepanelStyles = readFileSync(
  resolve(process.cwd(), 'entrypoints/sidepanel/sidepanel.css'),
  'utf8'
);

describe('sidepanel motion styles', () => {
  it('keeps status glyphs correct without animating hidden loaders', () => {
    expect(sidepanelStyles).toContain(
      ".analysis-trace li[data-status='pending'] [data-glyph='pending-skipped']"
    );
    expect(sidepanelStyles).toContain(
      ".analysis-trace li[data-status='skipped'] [data-glyph='pending-skipped']"
    );
    expect(sidepanelStyles).toContain(
      ".analysis-trace li[data-status='running'] .trace-spinner"
    );
    expect(sidepanelStyles).not.toMatch(
      /(?:^|\n)\.trace-spinner\s*\{[^}]*animation:/
    );
  });

  it('keeps interaction motion focused and usable at 300px', () => {
    expect(sidepanelStyles).toContain('min-width: 280px');
    expect(sidepanelStyles).toContain('@media (max-width: 340px)');
    expect(sidepanelStyles).toContain('@media (max-height: 680px)');
    expect(sidepanelStyles).toContain('--agent-motion-press: 100ms');
    expect(sidepanelStyles).toContain('--agent-motion-slow: 220ms');
    expect(sidepanelStyles).not.toContain('transition: all');
    expect(sidepanelStyles).toContain('button:not(:disabled):active');
    expect(sidepanelStyles).not.toContain('@keyframes message-enter');
    expect(sidepanelStyles).not.toContain('@keyframes status-enter');
    expect(sidepanelStyles).not.toContain('.message-list article:last-of-type');
    expect(sidepanelStyles).toContain(
      ".message-list article[data-role='assistant'][data-arrival='remote']"
    );
    expect(sidepanelStyles).toContain('@starting-style');
    expect(sidepanelStyles).toContain('transform: translateY(4px)');
    expect(sidepanelStyles).not.toContain('@keyframes agent-pulse');
    expect(sidepanelStyles).not.toContain('@keyframes agent-state-halo');
    expect(sidepanelStyles).not.toMatch(/font-size: (?:8|9|10)px/);
    expect(sidepanelStyles).toContain('field-sizing: content');
    expect(sidepanelStyles).toContain('resize: none');

    const hoverMedia = sidepanelStyles.indexOf(
      '@media (hover: hover) and (pointer: fine)'
    );
    expect(hoverMedia).toBeGreaterThan(-1);
    expect(sidepanelStyles.indexOf(':hover')).toBeGreaterThan(hoverMedia);
    expect(sidepanelStyles.slice(0, hoverMedia)).not.toContain(':hover');
  });

  it('provides typography and accessibility fallbacks', () => {
    expect(sidepanelStyles).toMatch(/\*::after\s*\{\s*letter-spacing:\s*0;/);
    expect(sidepanelStyles).toContain(
      '@media (prefers-reduced-motion: reduce)'
    );
    expect(sidepanelStyles).toContain(
      '@media (prefers-reduced-transparency: reduce)'
    );
    expect(sidepanelStyles).toContain('@media (prefers-contrast: more)');
  });
});
