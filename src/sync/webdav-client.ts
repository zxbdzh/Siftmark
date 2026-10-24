import { MAX_SYNC_BYTES, SYNC_FILE, type SyncSecret, type WebDavConfig } from './types';

export function normalizeWebDavEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入有效的 WebDAV HTTP 或 HTTPS 地址'); }
  // HTTP 端点兼容既有配置；认证仍由独立字段承载，避免把凭据写入 URL。
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash)
    throw new Error('WebDAV 仅支持 HTTP 或 HTTPS；帐号密码请填在独立输入框中');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export class WebDavClient {
  constructor(private readonly config: WebDavConfig & SyncSecret, private readonly fetcher: typeof fetch = fetch) {}

  async read(): Promise<Uint8Array | null> {
    const result = await this.request(SYNC_FILE, 'GET');
    return result.status === 404 ? null : result.bytes;
  }

  // 手动备份允许覆盖同名密文；并发合并和 ETag 条件写入已从产品范围移除。
  async write(bytes: Uint8Array): Promise<void> {
    await this.request(SYNC_FILE, 'PUT', bytes);
  }

  async test(): Promise<void> {
    const name = `.siftmark-probe-${crypto.randomUUID()}`;
    const payload = new TextEncoder().encode('Siftmark WebDAV connection test');
    let created = false;
    try {
      await this.request(name, 'PUT', payload);
      created = true;
      const read = await this.request(name, 'GET');
      if (read.status === 404 || new TextDecoder().decode(read.bytes) !== new TextDecoder().decode(payload)) throw new Error('WebDAV 写入后读取不一致');
    } finally {
      if (created) await this.request(name, 'DELETE').catch(() => undefined);
    }
  }

  private async request(name: string, method: string, body?: Uint8Array) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const utf8 = new TextEncoder().encode(`${this.config.username}:${this.config.password}`);
      let binary = ''; for (const byte of utf8) binary += String.fromCharCode(byte);
      const response = await this.fetcher.call(globalThis, new URL(name, this.config.endpoint).href, {
        method, redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { Authorization: `Basic ${btoa(binary)}`, ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) },
        ...(body ? { body: Uint8Array.from(body).buffer } : {})
      });
      if (response.status === 401 || response.status === 403) throw new Error(`WebDAV 认证失败（HTTP ${response.status}），请检查帐号及应用密码`);
      if (response.status !== 404 && !response.ok) throw new Error(`WebDAV 请求失败（HTTP ${response.status}）`);
      if (response.status === 404 && method !== 'GET') throw new Error('WebDAV 目录不存在，请先在服务器创建所填目录');
      if (Number(response.headers.get('content-length')) > MAX_SYNC_BYTES) throw new Error('备份文件超过 64 MB 上限');
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) {
        try {
          for (;;) {
            const result = await reader.read(); if (result.done) break;
            size += result.value.byteLength;
            if (size > MAX_SYNC_BYTES) { await reader.cancel(); throw new Error('备份文件超过 64 MB 上限'); }
            chunks.push(result.value);
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { status: response.status, bytes };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('WebDAV 请求超时，请稍后重试');
      if (error instanceof TypeError) throw new Error('无法连接 WebDAV；请检查网络、证书和地址，重定向不会携带密码');
      throw error;
    } finally { clearTimeout(timer); }
  }
}
