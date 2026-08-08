import { Layers, RotateCcw, SquareCheckBig } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BrowserTab, SaveService } from '../../bookmarks/save-service';

export function TabBatchSave({ service, tabs, folderId, onUndoBatch }: { service: SaveService; tabs: BrowserTab[]; folderId?: string; onUndoBatch?(batchId: string): Promise<{ completed: number; failed: number }> }) {
  const supported = useMemo(() => { const seen = new Set<string>(); return tabs.filter((tab) => { if (tab.id === undefined || !tab.url || !/^https?:/i.test(tab.url) || seen.has(tab.url)) return false; seen.add(tab.url); return true; }); }, [tabs]);
  const [selected, setSelected] = useState(() => new Set<number>());
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [batchId, setBatchId] = useState<string>();
  const toggle = (id: number) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const save = async () => {
    if (!folderId) return;
    const chosen = supported.filter((tab) => tab.id !== undefined && selected.has(tab.id));
    const results = await service.saveTabs(chosen, { parentId: folderId, duplicateAction: 'cancel' });
    setBatchId(results.find((result) => result.batchId)?.batchId);
    setStatus(`已处理 ${results.length} 个标签页`);
  };
  const undoBatch = async () => {
    if (!batchId || !onUndoBatch) return;
    const result = await onUndoBatch(batchId);
    setStatus(`已撤销 ${result.completed} 个，${result.failed} 个未撤销`);
    if (result.failed === 0) setBatchId(undefined);
  };
  const requestSave = () => { if (selected.size > 20) setConfirming(true); else void save(); };
  return <details className="batch-save"><summary><Layers size={16}/>批量保存标签页</summary><div className="batch-toolbar"><button type="button" className="text-button" onClick={() => { setSelected(new Set(supported.flatMap((tab) => tab.id === undefined ? [] : [tab.id]))); setConfirming(false); }}><SquareCheckBig size={15}/>全选 {supported.length} 项</button></div><ul>{supported.map((tab) => <li key={tab.id}><label><input type="checkbox" checked={tab.id !== undefined && selected.has(tab.id)} onChange={() => { if (tab.id !== undefined) toggle(tab.id); setConfirming(false); }}/><span>{tab.title || tab.url}</span></label></li>)}</ul>{confirming ? <div role="alert" className="batch-confirm"><p>将创建最多 {selected.size} 个书签，并为每项排队执行 AI 分析。</p><button type="button" onClick={() => { setConfirming(false); void save(); }}>确认保存 {selected.size} 项</button><button type="button" className="text-button" onClick={() => setConfirming(false)}>取消</button></div> : <button type="button" disabled={!folderId || selected.size === 0} onClick={requestSave}>保存所选 {selected.size} 项</button>}{batchId && onUndoBatch ? <button type="button" className="secondary-button" onClick={() => void undoBatch()}><RotateCcw size={16}/>撤销本次批量保存</button> : null}{status ? <p role="status">{status}</p> : null}</details>;
}
