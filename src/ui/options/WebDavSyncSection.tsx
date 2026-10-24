import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Cloud, ShieldCheck, X } from 'lucide-react';
import type { SyncStatus } from '../../sync/webdav-sync-service';
import { SYNC_STATE_KEY } from '../../sync/types';

import { downloadEncryptedSyncBackup } from '../../backup/download-sync-backup';
import { openSiftmarkDatabase } from '../../storage/database';
type SyncInput = Record<string, unknown>;
async function request<T>(type: string, input?: SyncInput): Promise<T> { return browser.runtime.sendMessage({type, input}); }
const initial: SyncStatus = {status: 'idle', message: '尚未连接 WebDAV', connected: false};

export function WebDavSyncSection() {
  const [endpoint, setEndpoint] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const database = useMemo(() => openSiftmarkDatabase(), []);


  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const result = await request<SyncStatus>('webdav-sync-status');
      if (alive) setStatus(result);
    };
    void Promise.all([
      request<{endpoint: string; username: string} | null>('webdav-sync-configure'),
      refresh()
    ]).then(([config]) => {
      if (alive && config) { setEndpoint(config.endpoint); setUsername(config.username); }
    }).catch(cause => { if (alive) setError(String(cause)); });
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && changes[SYNC_STATE_KEY]) void refresh().catch(cause => { if (alive) setError(String(cause)); });
    };
    browser.storage.onChanged.addListener(listener);
    return () => { alive = false; browser.storage.onChanged.removeListener(listener); };
  }, []);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await work(); setStatus(await request<SyncStatus>('webdav-sync-status')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const download = () => act(async () => {
    await request('webdav-sync-download');
    const buffer = await database.syncDownloadBuffers.get('webdav');
    if (!buffer) throw new Error('云端备份已校验，但下载文件未准备好，请重试');
    try {
      // 大文件通过 Blob URL 交给 downloads API，避免 data URL 被截断。
      await downloadEncryptedSyncBackup(new Uint8Array(buffer.bytes));
      await request('webdav-sync-download-complete');
    } finally {
      await database.syncDownloadBuffers.delete('webdav');
    }
  });

  const connect = () => act(async () => {
    const result = await request<{success: boolean; error?: string}>('webdav-sync-connect', {endpoint, username, password, encryptionPassword});
    if (!result.success) throw new Error(result.error ?? '连接失败');
    setPassword(''); setEncryptionPassword('');
  });
  const connected = status.connected;
  const pending = status.status === 'uploading' || status.status === 'downloading';

  return <section className="webdav-sync-section" aria-labelledby="webdav-sync-heading">
    <div className="profile-list-heading">
      <div><h2 id="webdav-sync-heading"><Cloud size={18}/>WebDAV 手动备份</h2><p>把书签、目录、笔记、应用配置和学习数据加密成一个快照文件。下载只保存密文，不会直接覆盖本机数据。</p></div>
      <span>{connected ? '本会话已连接' : '未连接'}</span>
    </div>
    <form onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label>WebDAV 地址<input type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://dav.example.com/siftmark/" required autoComplete="url"/></label>
      <label>用户名<input value={username} onChange={event => setUsername(event.target.value)} required autoComplete="username"/></label>
      <label>应用密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" placeholder="仅保存在当前浏览器会话"/></label>
      <label>独立加密口令<input type="password" value={encryptionPassword} onChange={event => setEncryptionPassword(event.target.value)} required minLength={12} autoComplete="new-password" placeholder="至少 12 个字符，各设备使用相同口令"/></label>
      <div className="form-actions">
        <button type="submit" disabled={busy || pending}><ShieldCheck size={16}/>验证并连接</button>
        <button type="button" disabled={busy || pending || !connected} onClick={() => void act(() => request('webdav-sync-upload'))}><ArrowUpToLine size={16}/>上传本机备份</button>
        <button type="button" disabled={busy || pending || !connected} onClick={() => void download()}><ArrowDownToLine size={16}/>下载云端备份</button>
        <button type="button" disabled={busy || pending || !connected} onClick={() => void act(() => request('webdav-sync-forget'))}><X size={16}/>断开</button>
      </div>
    </form>
    <output role="status">{error || (busy ? '正在处理…' : status.message)}{status.lastSyncAt ? ' · ' + new Date(status.lastSyncAt).toLocaleString() : ''}</output>
    {status.size ? <p className="field-help">最近备份大小：{Math.ceil(status.size / 1024)} KB。下载完成后请在系统下载目录中自行导入或保管。</p> : null}
  </section>;
}
