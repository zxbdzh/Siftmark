import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

describe('project metadata', () => {
  it('identifies the extension as Siftmark', () => {
    expect(pkg.name).toBe('siftmark');
    expect(pkg.private).toBe(true);
  });
});
