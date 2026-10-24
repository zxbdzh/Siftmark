import {beforeEach, describe, expect, it, vi} from 'vitest';
import {UpdateService, UPDATE_AUTO_KEY} from '../../../src/updates/update-service';
import type {SyncStorage} from '../../../src/sync/types';
let values: Record<string,unknown>;
let local: SyncStorage;
beforeEach(()=>{values={};local={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[String(keys)]).map(key=>[key,values[key]])),set:async items=>{Object.assign(values,items);},remove:async()=>undefined};vi.stubGlobal('navigator',{locks:{request:async(...args:unknown[])=>(args.at(-1) as (lock:object)=>Promise<unknown>)({})}});});
describe('自动更新任务边界',()=>{
 it('发现新版后默认只提示，不替换或重载',async()=>{
   const native=vi.fn(async()=>({ok:true as const,state:'available' as const,latest:'0.2.0'})),reload=vi.fn();const service=new UpdateService({local,native,reload,currentVersion:'0.1.8',isBusy:async()=>false});
   expect((await service.check()).state).toBe('available');expect(native.mock.calls).toHaveLength(1);expect(reload).not.toHaveBeenCalled();
 });
 it('自动更新在任务进行中等待，任务结束后才执行替换与重载',async()=>{
   let busy=true;values[UPDATE_AUTO_KEY]=true;const native=vi.fn(async(action:string)=>({ok:true as const,state:action==='apply'?'awaiting-reload' as const:'available' as const,latest:'0.2.0',version:'0.2.0'})),reload=vi.fn();
   const service=new UpdateService({local,native,reload,currentVersion:'0.1.8',isBusy:async()=>busy});
   expect((await service.check()).state).toBe('waiting');expect(native).not.toHaveBeenCalledWith('apply');
   busy=false;await service.check();expect(native).toHaveBeenCalledWith('apply');expect(reload).toHaveBeenCalledOnce();
 });
 it('哈希校验失败保留当前版本且不重载',async()=>{
   const native=vi.fn(async(action:string)=>action==='apply'?{ok:false,error:'SHA-256 mismatch'}:{ok:true,state:'available' as const,latest:'0.2.0'}),reload=vi.fn();
   const service=new UpdateService({local,native,reload,currentVersion:'0.1.8',isBusy:async()=>false});
   expect((await service.check(true)).message).toContain('SHA-256');expect(reload).not.toHaveBeenCalled();
 });
 it('重载后仅当前运行版本匹配时确认更新，旧进程不能提前确认',async()=>{
   const native=vi.fn(async()=>({ok:true,state:'awaiting-reload' as const,version:'0.2.0'})),reload=vi.fn();
   const service=new UpdateService({local,native,reload,currentVersion:'0.2.0',isBusy:async()=>false});await service.initialize();expect(native).toHaveBeenCalledWith('ack');
   native.mockClear();const old=new UpdateService({local,native,reload,currentVersion:'0.1.8',isBusy:async()=>false});await old.initialize();expect(native).not.toHaveBeenCalledWith('ack');
 });
 it('书签任务占用维护锁时，中断重载与恢复旧版都不能打断它',async()=>{
   vi.stubGlobal('navigator',{locks:{request:async(name:string,...args:unknown[])=>(args.at(-1) as (lock:object|null)=>Promise<unknown>)(name==='siftmark-maintenance'?null:{})}});
   const native=vi.fn(async()=>({ok:true,state:'awaiting-reload' as const,version:'0.2.0'})),reload=vi.fn();
   const service=new UpdateService({local,native,reload,currentVersion:'0.1.8',isBusy:async()=>false});
   expect((await service.check()).state).toBe('waiting');expect(reload).not.toHaveBeenCalled();
   await expect(service.rollback()).rejects.toThrow('进行中的任务');expect(native).not.toHaveBeenCalledWith('rollback');
 });
 it('恢复旧版关闭自动升级，避免立刻再次安装同一个问题版本',async()=>{
   values[UPDATE_AUTO_KEY]=true;const native=vi.fn(async()=>({ok:true,state:'rolled-back' as const})),reload=vi.fn();const service=new UpdateService({local,native,reload,currentVersion:'0.2.0',isBusy:async()=>false});
   await service.rollback();expect(values[UPDATE_AUTO_KEY]).toBe(false);expect(reload).toHaveBeenCalledOnce();
 });
});
