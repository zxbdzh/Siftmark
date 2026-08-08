import { describe, expect, it, vi } from 'vitest';
import { evaluatePagePolicy } from '../../../src/capture/page-policy';
import { extractPageCapture } from '../../../src/capture/extract-page';

const pageLocation = (overrides: Partial<Location> = {}) => ({ href: 'https://example.com/article', protocol: 'https:', hostname: 'example.com', pathname: '/article', ...overrides }) as Location;

describe('page capture policy', () => {
  it('blocks password, payment, internal, blocklisted, and intranet pages', () => {
    document.body.innerHTML = '<input type="password">';
    expect(evaluatePagePolicy(document, pageLocation())).toMatchObject({ body: 'blocked', screenshot: 'blocked', reason: 'password' });
    document.body.innerHTML = '';
    expect(evaluatePagePolicy(document, pageLocation({ pathname: '/checkout/payment' }))).toMatchObject({ reason: 'payment' });
    expect(evaluatePagePolicy(document, pageLocation({ protocol: 'chrome:' }))).toMatchObject({ reason: 'internal' });
    expect(evaluatePagePolicy(document, pageLocation(), ['example.com'])).toMatchObject({ reason: 'blocked-domain' });
    expect(evaluatePagePolicy(document, pageLocation({ hostname: '192.168.1.5' }))).toMatchObject({ reason: 'intranet' });
  });

  it('extracts readable metadata without calling storage or retaining form content', () => {
    const storage = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { set: storage } } });
    document.head.innerHTML = '<title>文章</title><link rel="canonical" href="https://example.com/canonical"><meta name="description" content="摘要"><meta name="keywords" content="AI, 书签">';
    document.body.innerHTML = '<nav>导航</nav><article><h1>正文</h1><p>第一段</p><form><input value="secret"></form><script>bad()</script></article>';
    const capture = extractPageCapture(document, pageLocation());
    expect(capture).toMatchObject({ title: '文章', canonicalUrl: 'https://example.com/canonical', description: '摘要', keywords: ['AI', '书签'] });
    expect(capture.text).toContain('第一段');
    expect(capture.text).not.toContain('导航');
    expect(capture.text).not.toContain('secret');
    expect(storage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
