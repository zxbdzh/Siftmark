import type { HealthStatus } from '../storage/types';

export interface LinkHealth {
  url: string;
  status: HealthStatus;
  httpStatus?: number;
  finalUrl?: string;
  redirected: boolean;
  checkedAt: number;
}

export interface LinkCheckOptions {
  signal?: AbortSignal;
  concurrencyPerDomain?: number;
}

export class LinkChecker {
  constructor(private readonly fetcher: typeof globalThis.fetch = globalThis.fetch, private readonly now: () => number = Date.now) {}

  async check(url: string, signal?: AbortSignal): Promise<LinkHealth> {
    try {
      let response = await this.fetcher(url, { method: 'HEAD', redirect: 'follow', signal });
      if (response.status === 405 || response.status === 501) response = await this.fetcher(url, { method: 'GET', redirect: 'follow', signal, headers: { range: 'bytes=0-0' } });
      return { url, status: classifyStatus(response.status), httpStatus: response.status, finalUrl: response.url || url, redirected: response.redirected || Boolean(response.url && response.url !== url), checkedAt: this.now() };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { url, status: isBlockedError(error) ? 'blocked' : 'temporary', redirected: false, checkedAt: this.now() };
    }
  }

  async checkMany(urls: string[], options: LinkCheckOptions = {}): Promise<LinkHealth[]> {
    const groups = new Map<string, string[]>();
    for (const url of urls) { const domain = domainOf(url); groups.set(domain, [...(groups.get(domain) ?? []), url]); }
    const results = await Promise.all([...groups.values()].map((group) => runWithConcurrency(group, Math.max(1, options.concurrencyPerDomain ?? 2), (url) => this.check(url, options.signal), options.signal)));
    return results.flat();
  }
}

function classifyStatus(status: number): HealthStatus {
  if (status === 401 || status === 403) return 'restricted';
  if (status === 404 || status === 410) return 'dead';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'temporary';
  if (status >= 200 && status < 400) return 'healthy';
  return 'blocked';
}

async function runWithConcurrency<T>(items: string[], concurrency: number, run: (item: string) => Promise<T>, signal?: AbortSignal): Promise<T[]> {
  const results = new Array<T>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) break;
      const index = next;
      next += 1;
      results[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return results.filter((result) => result !== undefined);
}

function domainOf(value: string): string { try { return new URL(value).hostname.toLocaleLowerCase(); } catch { return ''; } }
function isBlockedError(error: unknown): boolean { return error instanceof DOMException && ['SecurityError', 'NotAllowedError'].includes(error.name); }
