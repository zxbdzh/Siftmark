import { useState } from 'react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkNode } from '../../bookmarks/types';

export function DetailPanel({ bookmark, repository }: { bookmark?: BookmarkNode; repository: BookmarkRepository }) {
  const [title, setTitle] = useState(bookmark?.title ?? '');
  if (!bookmark) return <p className="empty-state">选择一个书签查看详情</p>;
  return <form onSubmit={(event) => { event.preventDefault(); void repository.update(bookmark.id, { title }); }}><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>网址<input value={bookmark.url ?? ''} readOnly /></label><button type="submit">保存标题</button></form>;
}
