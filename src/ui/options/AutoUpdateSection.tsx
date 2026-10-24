import {useEffect, useState} from 'react';
import {Download, RefreshCw, RotateCcw} from 'lucide-react';
import {UPDATE_KEY, type UpdateStatus} from '../../updates/update-service';


const request = (message: {type: string; input?: Record<string, unknown>}) =>
  (browser.runtime.sendMessage as unknown as (message: unknown) => Promise<unknown>)(message);
export function AutoUpdateSection() {
  const [state, setState] = useState<UpdateStatus>({state: 'idle', message: '每台 Windows 电脑安装一次更新器', auto: false, current: browser.runtime.getManifest().version});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [restore, setRestore] = useState(false);
  useEffect(() => {
    let alive = true;
    void request({type: 'updater-status'}).then(value => {if (alive) setState(value as UpdateStatus);}).catch(cause => {if (alive) setError(String(cause));});
    const listener = (changes: Record<string, {newValue?: unknown}>, area: string) => {if (alive && area === 'local' && changes[UPDATE_KEY]?.newValue) setState(changes[UPDATE_KEY]!.newValue as UpdateStatus);};
    browser.storage.onChanged.addListener(listener); return () => {alive = false; browser.storage.onChanged.removeListener(listener);};
  }, []);
  const act = async (type: string, enabled?: boolean) => {
    setBusy(true);setError('');try {const value = await request({type, input: {enabled}}) as UpdateStatus | undefined;if (value?.state) setState(value);}
    catch (cause) {setError(cause instanceof Error ? cause.message : String(cause));} finally {setBusy(false);}
  };
  const download = async () => {try {await browser.downloads.download({url: new URL('siftmark-windows-updater.zip', browser.runtime.getURL('/options.html')).href, filename: 'siftmark-windows-updater.zip', conflictAction: 'uniquify'});}catch(cause){setError(String(cause));}};
  return <section className="webdav-sync-section" aria-labelledby="auto-update-heading">
    <h2 id="auto-update-heading">Windows 自动更新</h2><p>从 GitHub 稳定版检查更新，校验安装包后在任务空闲时重载。替换失败会恢复旧版文件。</p>
    <dl className="update-facts"><div><dt>当前版本</dt><dd>{state.current}{state.latest ? ' · GitHub ' + state.latest : ''}</dd></div><div><dt>更新器</dt><dd>{state.target ?? '尚未绑定安装目录'}</dd></div></dl>
    <label className="inline-control"><input type="checkbox" checked={state.auto} disabled={busy} onChange={event => void act('updater-configure', event.target.checked)}/>自动检查并在空闲时更新</label>
    <div className="form-actions"><button type="button" disabled={busy} onClick={() => void act('updater-check')}><RefreshCw size={16}/>检查更新</button><button type="button" disabled={busy || !['available','waiting'].includes(state.state)} onClick={() => void act('updater-install')}>立即更新</button><button type="button" onClick={() => void download()}><Download size={16}/>下载 Windows 更新器</button></div>
    <output role="status">{error || (busy ? '正在处理…' : state.message)}</output>
    <details><summary>首次安装更新器</summary><p>解压下载文件，在该目录打开 PowerShell，填写当前解压加载的扩展目录：</p><code className="update-install-command">powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionPath "你的扩展目录" -ExtensionId {browser.runtime.id}</code><p>仅注册当前用户，无需管理员权限。安装后点“检查更新”。</p></details>
    <details><summary>恢复上一个版本</summary><p>恢复保留的旧版文件并重载；同时关闭自动更新，书签及设置仍保留。</p><label className="inline-control"><input type="checkbox" checked={restore} onChange={event => setRestore(event.target.checked)}/>确认恢复旧版</label><button type="button" disabled={busy || !restore} onClick={() => void act('updater-rollback')}><RotateCcw size={16}/>恢复并重载</button></details>
  </section>;
}
