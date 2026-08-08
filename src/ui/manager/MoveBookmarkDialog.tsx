import { FolderInput, X } from 'lucide-react';
import type { BookmarkNode } from '../../bookmarks/types';

export function MoveBookmarkDialog({ bookmark, folders, onMove, onClose }: { bookmark: BookmarkNode; folders: BookmarkNode[]; onMove(folderId: string): void; onClose(): void }) {
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="move-dialog" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title"><header><h2 id="move-dialog-title">移动“{bookmark.title}”</h2><button type="button" className="icon-button" aria-label="关闭移动窗口" onClick={onClose}><X size={18}/></button></header><div className="move-destinations" role="listbox" aria-label="目标文件夹">{folders.filter((folder) => folder.id !== bookmark.parentId).map((folder) => <button type="button" role="option" aria-selected="false" key={folder.id} onClick={() => onMove(folder.id)}><FolderInput size={16}/><span>{folder.title || '书签'}</span></button>)}</div></section></div>;
}
