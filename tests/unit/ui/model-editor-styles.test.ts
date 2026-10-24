import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'entrypoints/options/options.css'),
  'utf8'
);

describe('model editor layout', () => {
  it('keeps fields and actions in separate vertical blocks instead of the settings form grid', () => {
    const form = css.match(/\.model-profile-editor form\s*\{([^}]*)\}/)?.[1];
    expect(form).toContain('display: flex');
    expect(form).toContain('flex-direction: column');
    expect(form).toContain('align-items: stretch');
    expect(css).toContain('.model-editor-fields > label');
  });

  it('stacks fields and capability controls on small screens', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 620px)'));
    expect(mobile).toContain('.model-editor-fields');
    expect(mobile).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(mobile).toContain('.model-editor-fields > .form-fieldset');
    expect(mobile).toContain('grid-column: 1');
  });
});
