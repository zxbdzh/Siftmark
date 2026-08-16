import { ProviderError, kindForStatus } from './errors';

export interface ProviderJsonRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

export async function postProviderJson<T>(request: ProviderJsonRequest): Promise<T> {
  if (request.signal.aborted)
    throw new ProviderError('abort', '模型请求已取消');

  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, request.timeoutMs);
  try {
    const response = await (request.fetch ?? globalThis.fetch)(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      throw new ProviderError(kindForStatus(response.status), `Provider request failed with HTTP ${response.status}`, response.status, parseRetryAfter(retryAfter));
    }
    try {
      return await response.json() as T;
    } catch {
      throw new ProviderError('validation', 'Provider returned invalid JSON', response.status);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (request.signal.aborted)
      throw new ProviderError('abort', '模型请求已取消');
    if (timedOut)
      throw new ProviderError('network', '模型请求超时');
    throw new ProviderError('network', '模型网络请求失败');
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
