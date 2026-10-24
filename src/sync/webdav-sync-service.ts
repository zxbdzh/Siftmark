import { createEncryptedContainer, decryptEncryptedContainer } from '../backup/encrypted-container';
import { stableStringify } from '../backup/native-exporter';
import type { BookmarkRepository } from '../bookmarks/ports';
import type { SiftmarkDatabase } from '../storage/database';
import { captureSyncData } from './sync-data';
import { parseSyncDocument, SYNC_CONFIG_KEY, SYNC_STATE_KEY, MAX_SYNC_BYTES,
  type SyncState, type SyncStorage, type SyncSecret, type WebDavConfig } from './types';
import { normalizeWebDavEndpoint, WebDavClient } from './webdav-client';

type DownloadBackup = (bytes: Uint8Array) => Promise<void>;
const SECRET_KEY = 'siftmark.sync.webdav-credentials.session.v1';

export interface SyncDependencies {
  local: SyncStorage;
  session: SyncStorage;
  database: SiftmarkDatabase;
  bookmarks: BookmarkRepository;
  download?: DownloadBackup;
  isBusy?(): Promise<boolean>;
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface SyncStatus {
  status: SyncState['status'];
  message: string;
  lastSyncAt?: number;
  connected: boolean;
  size?: number;
}

export class WebDavSyncService {
  constructor(private readonly deps: SyncDependencies) {}

  // 保留生命周期入口，兼容扩展启动顺序；手动备份不创建闹钟，也不恢复执行计划。
  async initialize(): Promise<void> {}

  private now() { return (this.deps.now ?? Date.now)(); }

  private async locked<T>(work: () => Promise<T>): Promise<T> {
    return await navigator.locks.request('siftmark-maintenance', {ifAvailable: true}, async lock => {
      if (!lock) throw new Error('书签任务或更新正在执行，请结束后重试备份');
      return await navigator.locks.request('siftmark-webdav-backup', () => navigator.locks.request('siftmark-agent-learning', work));
    });
  }

  async connect(endpoint: string, username: string, password: string, encryptionPassword: string): Promise<WebDavConfig> {
    return this.locked(async () => {
      const config = {endpoint: normalizeWebDavEndpoint(endpoint), username: username.trim()};
      if (!config.username || !password.trim() || encryptionPassword.length < 12) throw new Error('请输入帐号、应用密码及至少 12 个字符的独立加密口令');
      const secret = {password, encryptionPassword};
      await this.client(config, secret).test();
      await this.deps.session.set({[SECRET_KEY]: secret});
      await this.deps.local.set({[SYNC_CONFIG_KEY]: config});
      const state = await this.getState();
      await this.save({...state, status: 'idle', message: 'WebDAV 已连接，可手动上传或下载加密备份'});
      return config;
    });
  }

  async config(): Promise<WebDavConfig | null> {
    const value = (await this.deps.local.get(SYNC_CONFIG_KEY))[SYNC_CONFIG_KEY] as Partial<WebDavConfig> | undefined;
    return value && typeof value.endpoint === 'string' && typeof value.username === 'string'
      ? {endpoint: normalizeWebDavEndpoint(value.endpoint), username: value.username}
      : null;
  }

  async forgetCredentials(): Promise<void> {
    await this.locked(async () => {
      await this.deps.session.remove(SECRET_KEY);
      const state = await this.getState();
      await this.save({...state, status: 'idle', message: '已断开 WebDAV，保留本机数据和云端文件'});
    });
  }

  async upload(): Promise<SyncStatus> {
    return this.locked(async () => {
      try {
        await this.requireIdle();
        const config = await this.config(); if (!config) throw new Error('尚未配置 WebDAV');
        const secret = await this.secret();
        let state = await this.getState();
        await this.save({...state, status: 'uploading', message: '正在生成并上传加密备份'});
        const encrypted = await this.encodeSnapshot();
        try {
          await this.client(config, secret).write(encrypted);
          const verified = await this.client(config, secret).read();
          if (!verified) throw new Error('上传后未能读取云端备份');
          await this.decode(verified, secret);
          state = {...state, status: 'success', lastSyncAt: this.now(), size: verified.byteLength, message: '加密备份已上传；本机数据未改变'};
          await this.save(state);
          return this.status();
        } finally { encrypted.fill(0); }
      } catch (error) { return this.fail(error); }
    });
  }

  async download(): Promise<SyncStatus> {
    return this.locked(async () => {
      let remote: Uint8Array | null = null;
      try {
        const config = await this.config(); if (!config) throw new Error('尚未配置 WebDAV');
        const secret = await this.secret();
        let state = await this.getState();
        await this.save({...state, status: 'downloading', message: '正在读取并校验云端加密备份'});
        remote = await this.client(config, secret).read();
        if (!remote) throw new Error('云端还没有 Siftmark 加密备份');
        await this.decode(remote, secret);
        // 先校验密文，再交给设置页下载；后台不再构造可能被截断的 data URL。
        if (this.deps.download) {
          await this.deps.download(Uint8Array.from(remote));
        } else {
          await this.deps.database.syncDownloadBuffers.put({
            id: 'webdav',
            bytes: Uint8Array.from(remote).buffer,
            createdAt: this.now()
          });
        }
        const downloaded = Boolean(this.deps.download);
        state = {
          ...state,
          status: 'success',
          lastSyncAt: this.now(),
          size: remote.byteLength,
          message: downloaded ? '加密备份已下载；本机数据未改变' : '加密备份已准备下载；本机数据未改变'
        };
        await this.save(state);
        return this.status();
      } catch (error) { return this.fail(error); }
      finally { remote?.fill(0); }
    });
  }

  async completeDownload(): Promise<SyncStatus> {
    return this.locked(async () => {
      const state = await this.getState();
      if (state.status === 'success' && state.message === '加密备份已准备下载；本机数据未改变') {
        await this.save({...state, message: '加密备份已下载；本机数据未改变'});
      }
      return this.status();
    });
  }

  async status(): Promise<SyncStatus> {
    const state = await this.getState();
    return {
      status: state.status,
      message: state.message,
      lastSyncAt: state.lastSyncAt,
      size: state.size,
      connected: Boolean((await this.deps.session.get(SECRET_KEY))[SECRET_KEY])
    };
  }

  private async encodeSnapshot(): Promise<Uint8Array> {
    const snapshotState: SyncState = {
      id: 'webdav', deviceId: crypto.randomUUID(), ids: {}, rootIds: {}, baseEntries: {}, recycled: {}, status: 'idle', message: ''
    };
    const snapshot = await captureSyncData(await this.deps.bookmarks.getTree(), snapshotState, this.deps.database, this.deps.local);
    const plaintext = new TextEncoder().encode(stableStringify(parseSyncDocument(snapshot.document)));
    if (plaintext.byteLength > MAX_SYNC_BYTES - 65_536) throw new Error('备份数据超过 64 MB 上限');
    const secret = await this.secret();
    try { return await createEncryptedContainer(plaintext, secret.encryptionPassword); } finally { plaintext.fill(0); }
  }

  private async decode(bytes: Uint8Array, secret: SyncSecret) {
    try {
      const plaintext = await decryptEncryptedContainer(bytes, secret.encryptionPassword);
      try { return parseSyncDocument(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(plaintext))); }
      finally { plaintext.fill(0); }
    } catch (error) {
      if (error instanceof DOMException || error instanceof Error && /encrypted-backup|encrypted-container/.test(error.message)) throw new Error('独立加密口令不匹配或云端文件损坏，未下载本机数据');
      throw error;
    }
  }

  private async requireIdle() {
    if (await this.deps.database.tasks.where('state').equals('running').count() || await this.deps.isBusy?.()) throw new Error('存在进行中的任务；结束后重试备份');
  }

  private client(config: WebDavConfig, secret: SyncSecret) { return new WebDavClient({...config, ...secret}, this.deps.fetcher); }

  private async getState(): Promise<SyncState> {
    const stored = (await this.deps.database.syncStates.get('webdav'))?.value as Partial<SyncState> | undefined;
    const status = stored?.status === 'uploading' || stored?.status === 'downloading' || stored?.status === 'success' || stored?.status === 'failed' ? stored.status : 'idle';
    return {
      id: 'webdav', deviceId: typeof stored?.deviceId === 'string' ? stored.deviceId : crypto.randomUUID(),
      ids: {}, rootIds: {}, baseEntries: {}, recycled: {}, status,
      message: typeof stored?.message === 'string' ? stored.message : '尚未连接 WebDAV',
      ...(typeof stored?.lastSyncAt === 'number' ? {lastSyncAt: stored.lastSyncAt} : {}),
      ...(typeof stored?.size === 'number' ? {size: stored.size} : {})
    };
  }

  private async save(state: SyncState) {
    await this.deps.database.syncStates.put({id: 'webdav', value: state});
    await this.deps.local.set({[SYNC_STATE_KEY]: {status: state.status, message: state.message, lastSyncAt: state.lastSyncAt, size: state.size}});
  }

  private async secret(): Promise<SyncSecret> {
    const value = (await this.deps.session.get(SECRET_KEY))[SECRET_KEY] as SyncSecret | undefined;
    if (!value?.password || !value.encryptionPassword) throw new Error('当前会话尚未连接 WebDAV，请重新验证连接');
    return value;
  }

  private async fail(error: unknown) {
    const state = await this.getState();
    await this.save({...state, status: 'failed', message: error instanceof Error ? error.message : 'WebDAV 备份失败，请稍后重试'});
    return this.status();
  }
}
