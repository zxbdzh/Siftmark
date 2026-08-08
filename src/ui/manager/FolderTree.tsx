import { Folder } from 'lucide-react';
import type { BookmarkNode } from '../../bookmarks/types';
import { useManagerStore } from './manager-store';

export function FolderTree({ folders }: { folders: BookmarkNode[] }) {
  const selected = useManagerStore((state) => state.selectedFolderId);
  const select = useManagerStore((state) => state.selectFolder);
  return <div className="folder-tree" role="tree">{folders.map((folder) => <button className="tree-row" role="treeitem" aria-selected={selected === folder.id} key={folder.id} onClick={() => select(folder.id)}><Folder size={16} aria-hidden="true"/><span>{folder.title || '书签'}</span></button>)}</div>;
}
