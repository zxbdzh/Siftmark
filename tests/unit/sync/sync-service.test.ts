import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode } from '../../../src/bookmarks/types';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';
import { openSiftmarkDatabase, type SiftmarkDatabase } from '../../../src/storage/database';
import { WebDavSyncService } from '../../../src/sync/webdav-sync-service';
import type { SyncStorage } from '../../../src/sync/types';

const endpoint = 'https://dav.test/siftmark/';
let databases: SiftmarkDatabase[];
let files: Map<string, Uint8Array>;
let downloaded: Uint8Array[];
let fetcher: typeof fetch;

function storage(): SyncStorage {
  const values: Record<string, unknown> = {};
  return {
    get: async keys => Object.fromEntries((keys === null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys])
      .filter(key => Object.hasOwn(values, key)).map(key => [key, structuredClone(values[key])])),
    set: async valuesToSet => { Object.assign(values, structuredClone(valuesToSet)); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }
  };
}

function createService(title = '开发资料', withDownload = true) {
  const database = openSiftmarkDatabase('manual-backup-' + crypto.randomUUID());
  databases.push(database);
  const nodes: BookmarkNode[] = [
    {id: '0', parentId: '', index: 0, title: ''},
    {id: 'root', parentId: '0', index: 0, title: '书签栏'},
    {id: 'bookmark', parentId: 'root', index: 0, title, url: 'https://example.test/'},
  ];
  const bookmarks: BookmarkRepository = { getTree: async () => structuredClone(nodes) } as BookmarkRepository;
  const service = new WebDavSyncService({
    local: storage(), session: storage(), database, bookmarks,
    ...(withDownload ? {download: async (bytes: Uint8Array) => { downloaded.push(Uint8Array.from(bytes)); }} : {}), fetcher
  });
  return {service, nodes, database};
}

describe('WebDAV 手动加密备份', () => {
  beforeEach(() => {
    databases = []; files = new Map(); downloaded = [];
    vi.stubGlobal('navigator', {locks: {request: async (...args: unknown[]) => (args.at(-1) as (lock: object) => Promise<unknown>)({})}});
    fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
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
    }) as typeof fetch;
  });

  afterEach(async () => {
    for (const database of databases) { database.close(); await Dexie.delete(database.name); }
    vi.unstubAllGlobals();
  });

  it('上传加密快照并允许同名备份覆盖', async () => {
    const {service} = createService();
    await service.connect(endpoint, 'user', 'app-password', 'independent-password');
    expect((await service.upload()).status).toBe('success');
    const first = files.get(endpoint + 'siftmark-sync.v1.encrypted');
    expect(first).toBeTruthy();
    expect(new TextDecoder().decode(first)).not.toContain('开发资料');
    expect((await service.upload()).status).toBe('success');
    expect(files.size).toBe(1);
  });

  it('下载前校验口令，成功只交给系统下载且不改本机数据', async () => {
    const first = createService();
    await first.service.connect(endpoint, 'user', 'app-password', 'independent-password');
    await first.service.upload();

    const second = createService('本机原有');
    await second.service.connect(endpoint, 'user', 'app-password', 'independent-password');
    expect((await second.service.download()).status).toBe('success');
    expect(downloaded).toHaveLength(1);
    expect(second.nodes.map(node => node.title)).toContain('本机原有');
  });
  it('无页面下载回调时把完整密文交给设置页', async () => {
    const first = createService();
    await first.service.connect(endpoint, 'user', 'app-password', 'independent-password');
    await first.service.upload();

    const second = createService('本机原有', false);
    await second.service.connect(endpoint, 'user', 'app-password', 'independent-password');
    expect((await second.service.download()).status).toBe('success');
    const buffer = await second.database.syncDownloadBuffers.get('webdav');
    expect(buffer?.bytes.byteLength).toBe(files.get(endpoint + 'siftmark-sync.v1.encrypted')?.byteLength);
    expect((await second.service.completeDownload()).message).toContain('已下载');
    expect(new TextDecoder().decode(new Uint8Array(buffer?.bytes ?? new ArrayBuffer()))).not.toContain('开发资料');
  });


  it('口令错误或云端文件损坏时不产生下载文件', async () => {
    const first = createService();
    await first.service.connect(endpoint, 'user', 'app-password', 'independent-password');
    await first.service.upload();
    const second = createService();
    await second.service.connect(endpoint, 'user', 'app-password', 'wrong-password-long');
    const result = await second.service.download();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('口令');
    expect(downloaded).toHaveLength(0);
  });
});
