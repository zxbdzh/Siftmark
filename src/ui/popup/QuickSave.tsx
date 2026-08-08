import { BookmarkPlus, ExternalLink, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BookmarkNode } from '../../bookmarks/types';
import type { BrowserTab, DuplicateAction, SaveResult, SaveService } from '../../bookmarks/save-service';

interface QuickSaveProps {
  service: SaveService;
  tab?: BrowserTab;
  folders?: BookmarkNode[];
  defaultFolderId?: string;
  recentOperationId?: string;
  destinationHint?: string;
  queueAnalysis?: boolean;
  onDestinationChange?(folderId: string): void;
  onSaved?(result: SaveResult, folderId: string): void;
  onUndo?(operationId: string): Promise<void>;
}

export function QuickSave({ service, tab, folders = [], defaultFolderId, recentOperationId, destinationHint, queueAnalysis = true, onDestinationChange, onSaved, onUndo }: QuickSaveProps) {
  const [result, setResult] = useState<SaveResult>();
  const [saving, setSaving] = useState(false);
  const [folderId, setFolderId] = useState(defaultFolderId ?? 'auto');
  const [duplicates, setDuplicates] = useState<Array<{ id: string; title: string; parentId: string }>>([]);
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>('cancel');
  const [undoAvailable, setUndoAvailable] = useState(Boolean(recentOperationId));

  useEffect(() => { if (!folderId && defaultFolderId) setFolderId(defaultFolderId); }, [defaultFolderId, folderId]);
  useEffect(() => {
    let active = true;
    if (!tab) return;
    if (typeof service.previewDuplicates === 'function') void service.previewDuplicates(tab).then((matches) => { if (active) setDuplicates(matches); });
    return () => { active = false; };
  }, [service, tab]);

  const save = async () => {
    if (!tab || !folderId) return;
    setSaving(true);
    try {
      const next = await service.saveCurrentTab(tab, { parentId: folderId, duplicateAction, queueAnalysis });
      setResult(next);
      setUndoAvailable(Boolean(next.operationId));
      onSaved?.(next, folderId);
    } finally { setSaving(false); }
  };

  const operationId = result?.operationId ?? recentOperationId;
  return <section aria-labelledby="quick-save-title"><div><h2 id="quick-save-title">{tab?.title || '当前页面'}</h2><p className="popup-url">{tab?.url || '正在读取标签页…'}</p></div>{folders.length > 0 ? <label className="popup-field"><span>保存到</span><select value={folderId === 'auto' ? '' : folderId} onChange={(event) => { setFolderId(event.target.value); onDestinationChange?.(event.target.value); }}><option value="" disabled>选择文件夹</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title || '书签'}</option>)}</select></label> : null}{destinationHint ? <p className="destination-hint">{destinationHint}</p> : null}{duplicates.length > 0 ? <fieldset className="duplicate-panel"><legend>发现 {duplicates.length} 个相同网址</legend><button type="button" className="text-button" onClick={() => void browser.tabs.create({ url: tab?.url })}><ExternalLink size={15}/>打开现有项</button><label><input type="radio" name="duplicate-action" value="cancel" checked={duplicateAction === 'cancel'} onChange={() => setDuplicateAction('cancel')}/>不创建重复项</label><label><input type="radio" name="duplicate-action" value="update-title" checked={duplicateAction === 'update-title'} onChange={() => setDuplicateAction('update-title')}/>更新现有标题</label><label><input type="radio" name="duplicate-action" value="create-copy" checked={duplicateAction === 'create-copy'} onChange={() => setDuplicateAction('create-copy')}/>仍然创建副本</label></fieldset> : null}<button type="button" disabled={!tab || saving || (folders.length > 0 && folderId === 'auto')} onClick={() => void save()}><BookmarkPlus size={17}/>{saving ? '正在保存' : duplicates.length && duplicateAction === 'cancel' ? '保留现有书签' : '保存书签'}</button>{result?.status === 'saved' ? <p role="status">{result.analysisQueued ? '已保存，正在后台分析' : '已保存，本地规则已跳过 AI'}</p> : result?.status === 'updated' ? <p role="status">已更新现有书签标题</p> : result?.status === 'duplicate' ? <p role="status">已保留现有书签，未创建副本</p> : result?.status === 'unsupported' ? <p role="status">此页面无法保存</p> : null}{undoAvailable && operationId && onUndo ? <button type="button" className="secondary-button" onClick={() => void onUndo(operationId).then(() => setUndoAvailable(false))}><RotateCcw size={16}/>撤销最近保存</button> : null}</section>;
}
