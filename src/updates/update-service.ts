import type {SyncStorage} from '../sync/types';

export const UPDATE_HOST = 'com.siftmark.updater';
export const UPDATE_KEY = 'siftmark.updates.status.v1';
export const UPDATE_AUTO_KEY = 'siftmark.updates.auto.v1';
export const UPDATE_ALARM = 'siftmark-updates';
export interface NativeUpdateReply {ok: boolean; state?: 'current'|'available'|'awaiting-reload'|'rolled-back'; version?: string; latest?: string; target?: string; rollbackAvailable?: boolean; error?: string;}
export interface UpdateStatus {state: 'idle'|'checking'|'current'|'available'|'waiting'|'applying'|'failed'|'missing'; message: string; auto: boolean; current: string; latest?: string; target?: string; checkedAt?: number;}
interface UpdateDependencies {local: SyncStorage; currentVersion: string; native(action: string): Promise<NativeUpdateReply>; isBusy(): Promise<boolean>; reload(): void; now?: () => number;}
export class UpdateService {
  private applying = false;
  constructor(private readonly deps: UpdateDependencies) {}
  isApplying() {return this.applying;}
  async status(): Promise<UpdateStatus> {
    const stored = await this.deps.local.get([UPDATE_KEY, UPDATE_AUTO_KEY]);
    const value = stored[UPDATE_KEY] as UpdateStatus | undefined;
    return {...value, state: value?.state ?? 'idle', message: value?.message ?? '先安装 Windows 更新器，再启用自动更新', current: this.deps.currentVersion, auto: stored[UPDATE_AUTO_KEY] === true};
  }
  async configure(enabled: boolean) {await this.deps.local.set({[UPDATE_AUTO_KEY]: enabled});return this.check(false);}
  async check(install = false): Promise<UpdateStatus> {
    return navigator.locks.request('siftmark-updates', async () => {
      const state = {...await this.status(), checkedAt: (this.deps.now ?? Date.now)()};
      try {
        await this.save({...state, state: 'checking', message: '正在检查 GitHub 稳定版'});
        const reply = await this.call('check');
        if (reply.state === 'awaiting-reload') {
          if (reply.version === this.deps.currentVersion) {await this.call('ack'); return this.save({...state, state: 'current', latest: reply.version, message: '新版已重载并确认'});}
          if (await this.deps.isBusy()) return this.save({...state, state: 'waiting', latest: reply.version, message: '新版文件已就绪，任务结束后重载'});
          return await navigator.locks.request('siftmark-maintenance', {ifAvailable: true}, async lock => {
            if (!lock) return this.save({...state, state: 'waiting', latest: reply.version, message: '有进行中的书签任务，结束后重载'});
            await this.save({...state, state: 'waiting', latest: reply.version, message: '新版文件已就绪，正在重载'}); this.deps.reload(); return this.status();
          });
        }
        if (reply.state !== 'available') return this.save({...state, state: 'current', latest: reply.latest ?? reply.version, message: '当前已是最新稳定版', checkedAt: (this.deps.now ?? Date.now)()});
        const available = {...state, latest: reply.latest, checkedAt: (this.deps.now ?? Date.now)()};
        if (!install && !state.auto) return this.save({...available, state: 'available', message: '发现新版本，可立即更新'});
        if (await this.deps.isBusy()) return this.save({...available, state: 'waiting', message: '有进行中的任务，完成后自动更新'});
        return await navigator.locks.request('siftmark-maintenance', {ifAvailable: true}, async lock => {
          if (!lock) return this.save({...available, state: 'waiting', message: '有进行中的书签任务，结束后自动更新'});
          this.applying = true;
          await this.save({...available, state: 'applying', message: '正在校验并替换新版文件'});
          const applied = await this.call('apply');
          if (applied.state !== 'awaiting-reload') throw new Error('更新器未确认替换成功，未重载扩展');
          await this.save({...available, state: 'waiting', message: '新版已验证，正在重载扩展'});
          this.deps.reload(); return this.status();
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.save({...state, state: /not found|not registered|Specified native|未安装/.test(message) ? 'missing' : 'failed', message});
      } finally {this.applying = false;}
    });
  }
  async initialize() {
    try {
      const native = await this.call('status');
      if (native.state === 'awaiting-reload' && native.version === this.deps.currentVersion) await this.call('ack');
      await this.save({...await this.status(), target: native.target, state: 'idle', message: 'Windows 更新器已连接'});
    } catch { /* 未安装更新器时保持可用，设置页提供安装入口。 */ }
  }
  async rollback() {
    // 恢复旧版与首次升级共用排他锁，避免空闲检查后有新的书签任务进入。
    return navigator.locks.request('siftmark-updates', () => navigator.locks.request('siftmark-maintenance', {ifAvailable: true}, async lock => {
      if (!lock || await this.deps.isBusy()) throw new Error('有进行中的任务，请结束后再恢复旧版');
      this.applying = true;
      try {await this.call('rollback'); await this.save({...await this.status(), auto: false, state: 'waiting', message: '旧版文件已恢复，正在重载'});await this.deps.local.set({[UPDATE_AUTO_KEY]: false});this.deps.reload();}
      finally {this.applying = false;}
    }));
  }
  private async call(action: string) {const reply = await this.deps.native(action); if (!reply || reply.ok !== true) throw new Error(reply?.error ?? 'Windows 更新器未返回有效结果'); return reply;}
  private async save(status: UpdateStatus) {await this.deps.local.set({[UPDATE_KEY]: status}); return status;}
}
