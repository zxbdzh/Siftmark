import { describe, expect, it, vi } from 'vitest';
import { normalizeWebDavEndpoint, WebDavClient } from '../../../src/sync/webdav-client';
import { SYNC_FILE, type SyncSecret, type WebDavConfig } from '../../../src/sync/types';

const config: WebDavConfig & SyncSecret = {
  endpoint: 'https://dav.example.test/root/siftmark/', username: 'user', password: 'secret', encryptionPassword: 'long-independent-password'
};

function memoryDav() {
  const files = new Map<string, Uint8Array>();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = String(input);
    const method = init.method ?? 'GET';
    if (method === 'GET') {
      const body = files.get(key);
      return body ? new Response(body.slice(), {status: 200}) : new Response(null, {status: 404});
    }
    if (method === 'PUT') {
      const body = init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : new Uint8Array();
      files.set(key, Uint8Array.from(body));
      return new Response(null, {status: 201});
    }
    if (method === 'DELETE') { files.delete(key); return new Response(null, {status: 204}); }
    return new Response(null, {status: 405});
  }) as ReturnType<typeof vi.fn>;
  return {files, fetcher};
}

describe('WebDAV 手动备份协议', () => {
  it('规范化 HTTP/HTTPS 地址并拒绝凭据、查询参数和其他协议', () => {
    expect(normalizeWebDavEndpoint('https://dav.example.test/sync')).toBe('https://dav.example.test/sync/');
    expect(normalizeWebDavEndpoint('http://192.168.1.20/dav')).toBe('http://192.168.1.20/dav/');
    expect(() => normalizeWebDavEndpoint('https://user:pass@dav.example.test/dav')).toThrow('帐号密码');
    expect(() => normalizeWebDavEndpoint('https://dav.example.test/dav?token=x')).toThrow('帐号密码');
    expect(() => normalizeWebDavEndpoint('file:///tmp/sync')).toThrow('HTTP 或 HTTPS');
  });

  it('测试连接后可覆盖同一个密文文件并读回字节', async () => {
    const {files, fetcher} = memoryDav();
    const client = new WebDavClient(config, fetcher);
    await client.test();
    expect(files.size).toBe(0);
    const bytes = new TextEncoder().encode('encrypted snapshot');
    await client.write(bytes);
    expect(Array.from(files.get(new URL(SYNC_FILE, config.endpoint).href) ?? [])).toEqual(Array.from(bytes));
    await client.write(new TextEncoder().encode('new snapshot'));
    expect(new TextDecoder().decode((await client.read())!)).toBe('new snapshot');
  });

  it('远端不存在备份时返回空，不把认证信息放入请求地址', async () => {
    const {fetcher} = memoryDav();
    const client = new WebDavClient(config, fetcher);
    expect(await client.read()).toBeNull();
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('secret');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toMatch(/^Basic /);
  });
});
