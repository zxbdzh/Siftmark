import { evaluatePagePolicy } from './page-policy';
import { truncateByParagraph } from './truncate-content';
import type { LocationLike, PageCapture } from './types';

const REMOVE_SELECTOR = 'script,style,noscript,template,nav,header,footer,aside,form,button,input,textarea,select,option,[contenteditable="true"],[hidden],[aria-hidden="true"]';

export function extractPageCapture(document: Document, location: LocationLike, blockedDomains: string[] = []): PageCapture {
  const policy = evaluatePagePolicy(document, location, blockedDomains);
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.href;
  const description = metaContent(document, 'meta[name="description"]') || metaContent(document, 'meta[property="og:description"]');
  const keywords = metaContent(document, 'meta[name="keywords"]').split(',').map((value) => value.trim()).filter(Boolean);
  if (policy.body === 'blocked') return { title: preferredTitle(document), canonicalUrl: canonical, description, keywords, language: document.documentElement.lang || '', text: '', truncated: false, policy };
  const source = document.querySelector('article,main,[role="main"]') ?? document.body;
  const clone = source?.cloneNode(true) as HTMLElement | undefined;
  clone?.querySelectorAll(REMOVE_SELECTOR).forEach((node) => node.remove());
  clone?.querySelectorAll<HTMLElement>('[style]').forEach((node) => { if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') ?? '')) node.remove(); });
  const result = truncateByParagraph(clone?.innerText || clone?.textContent || '');
  return { title: preferredTitle(document), canonicalUrl: canonical, description, keywords, language: document.documentElement.lang || '', text: result.text, truncated: result.truncated, policy };
}

function preferredTitle(document: Document): string { return metaContent(document, 'meta[property="og:title"]') || document.title || document.querySelector('h1')?.textContent?.trim() || ''; }
function metaContent(document: Document, selector: string): string { return document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? ''; }
