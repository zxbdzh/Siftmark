import { describe, expect, it } from 'vitest';
import { normalizeUrlConservatively } from '../../../src/health/url-normalization';

describe('normalizeUrlConservatively', () => {
  it('normalizes host/default ports and removes only known tracking parameters', () => {
    expect(normalizeUrlConservatively('HTTPS://Example.COM:443/Case?utm_source=news&order=paid&gclid=x#section')).toBe('https://example.com/Case?order=paid#section');
  });

  it('preserves business parameters, path case, fragments, and non-http URLs', () => {
    expect(normalizeUrlConservatively('https://shop.test/Product?id=10&ref=partner#buy')).toBe('https://shop.test/Product?id=10&ref=partner#buy');
    expect(normalizeUrlConservatively('chrome://bookmarks/')).toBe('chrome://bookmarks/');
  });
});
