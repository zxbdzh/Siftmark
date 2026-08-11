import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const tokens = read('src/ui/styles/tokens.css');
const manager = read('src/ui/manager/manager.css');
const popup = read('entrypoints/popup/popup.css');

describe('extension shell motion styles', () => {
  it('uses one restrained timing vocabulary', () => {
    expect(tokens).toContain('--ease-out: cubic-bezier(0.23, 1, 0.32, 1)');
    expect(tokens).toContain('--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)');
    expect(tokens).toContain('--motion-press: 120ms');
    expect(tokens).toContain('--motion-state: 160ms');
    expect(tokens).toContain('--motion-feedback: 180ms');
    expect(`${manager}\n${popup}`).not.toContain('transition: all');
  });

  it('animates manager state and occasional menus without moving the tree', () => {
    expect(manager).toContain(".tree-disclosure svg[data-open='true']");
    expect(manager).toContain(".tree-context-menu[data-closing='true']");
    expect(manager).toContain('@starting-style');
    expect(manager).toContain('transform-origin: top left');
    expect(manager).toContain('@media (prefers-reduced-motion: reduce)');

    const hoverMedia = manager.indexOf(
      '@media (hover: hover) and (pointer: fine)'
    );
    expect(hoverMedia).toBeGreaterThan(-1);
    expect(manager.indexOf(':hover')).toBeGreaterThan(hoverMedia);
    expect(manager.slice(0, hoverMedia)).not.toContain(':hover');
  });

  it('keeps popup opening immediate and limits motion to feedback', () => {
    const shellRule = popup.match(/\.popup-shell\s*\{([^}]*)\}/)?.[1];
    expect(shellRule).toBeDefined();
    expect(shellRule).not.toContain('animation:');
    expect(shellRule).not.toContain('transition:');
    expect(popup).toContain('.task-actions button:active:not(:disabled)');
    expect(popup).toContain('@media (prefers-reduced-motion: reduce)');

    const hoverMedia = popup.indexOf(
      '@media (hover: hover) and (pointer: fine)'
    );
    expect(hoverMedia).toBeGreaterThan(-1);
    expect(popup.indexOf(':hover')).toBeGreaterThan(hoverMedia);
    expect(popup.slice(0, hoverMedia)).not.toContain(':hover');
  });
});
