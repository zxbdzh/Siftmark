import { Brain, ClipboardList, Copy, Download, ExternalLink, FolderInput, Tags, Trash2 } from 'lucide-react';

interface BookmarkContextMenuProps {
  onOpen(): void;
  onMove(): void;
  onAnalyze(): void;
  onQueueReview(): void;
  onTag(): void;
  onExport(): void;
  onCopy(): void;
  onRecycle(): void;
  recycleDisabledReason?: string;
}

export function BookmarkContextMenu(props: BookmarkContextMenuProps) {
  return <menu aria-label="书签操作">
    <button type="button" onClick={props.onOpen}><ExternalLink size={15}/>打开</button>
    <button type="button" onClick={props.onMove}><FolderInput size={15}/>移动到…</button>
    <button type="button" onClick={props.onAnalyze}><Brain size={15}/>AI 分析</button>
    <button type="button" onClick={props.onQueueReview}><ClipboardList size={15}/>加入审核</button>
    <button type="button" onClick={props.onTag}><Tags size={15}/>编辑标签</button>
    <button type="button" onClick={props.onExport}><Download size={15}/>导出此项</button>
    <button type="button" onClick={props.onCopy}><Copy size={15}/>复制链接</button>
    <button type="button" onClick={props.onRecycle} disabled={Boolean(props.recycleDisabledReason)} title={props.recycleDisabledReason}><Trash2 size={15}/>移到回收站</button>
  </menu>;
}
