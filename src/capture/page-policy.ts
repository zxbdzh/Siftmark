import type { LocationLike, PagePolicy } from './types';

const INTERNAL_PROTOCOLS = new Set(['chrome:', 'chrome-extension:', 'edge:', 'about:', 'file:', 'view-source:']);
const LOGIN_PATTERN = /(?:^|[\W_])(login|log-in|signin|sign-in|auth|oauth|sso|登录|登陆)(?:[\W_]|$)/i;
const PAYMENT_PATTERN = /(?:^|[\W_])(checkout|payment|billing|bank|wallet|pay|支付|收银台)(?:[\W_]|$)/i;

export function evaluatePagePolicy(document: Document, location: LocationLike, blockedDomains: string[] = []): PagePolicy {
  if (INTERNAL_PROTOCOLS.has(location.protocol)) return blocked('internal');
  const hostname = location.hostname.toLocaleLowerCase();
  if (blockedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return blocked('blocked-domain');
  if (isIntranetHost(hostname)) return blocked('intranet');
  if (document.querySelector('input[type="password"]')) return blocked('password');
  const context = `${location.pathname} ${document.title}`;
  if (PAYMENT_PATTERN.test(context)) return blocked('payment');
  if (LOGIN_PATTERN.test(context)) return blocked('login');
  return { body: 'allowed', screenshot: 'allowed' };
}

export function isIntranetHost(hostname: string): boolean {
  if (!hostname || hostname === 'localhost' || !hostname.includes('.')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)) return true;
  const private172 = /^172\.(\d{1,3})\./.exec(hostname);
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false;
}

function blocked(reason: NonNullable<PagePolicy['reason']>): PagePolicy { return { body: 'blocked', screenshot: 'blocked', reason }; }
