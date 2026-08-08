import { useEffect, useState } from 'react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import type { BookmarkNode } from '../../bookmarks/types';
import type { BookmarkCommandService } from '../../operations/bookmark-command-service';
import type { BookmarkMetadata, MetadataRepository } from '../../storage/types';
import { MarkdownNoteEditor } from './MarkdownNoteEditor';
import type { ThumbnailRepository } from '../../storage/thumbnail-repository';
import { ThumbnailPreview } from './ThumbnailPreview';

const emptyMetadata = (bookmarkId: string): BookmarkMetadata => ({ bookmarkId, summary: '', tags: [], note: '', confidence: 'unknown', reason: '', health: 'unchecked', updatedAt: Date.now() });

export function DetailPanel({ bookmark, repository, commands, metadataRepository, thumbnailRepository, onRefreshThumbnail }: { bookmark?: BookmarkNode; repository: BookmarkRepository; commands?: BookmarkCommandService; metadataRepository?: MetadataRepository; thumbnailRepository?: ThumbnailRepository; onRefreshThumbnail?(bookmark: BookmarkNode): void }) {
  const [title, setTitle] = useState(bookmark?.title ?? '');
  const [metadata, setMetadata] = useState<BookmarkMetadata>();
  const [status, setStatus] = useState('');
  useEffect(() => {
    setTitle(bookmark?.title ?? '');
    setStatus('');
    if (!bookmark) { setMetadata(undefined); return; }
    if (metadataRepository) void metadataRepository.get(bookmark.id).then((value) => setMetadata(value ?? emptyMetadata(bookmark.id)));
  }, [bookmark, metadataRepository]);
  if (!bookmark) return <p className="empty-state">选择一个书签查看详情</p>;
  const save = async () => {
    if (commands) {
      const renamed = await commands.rename({ bookmarkId: bookmark.id, title, expectedTitle: bookmark.title });
      if (!renamed.ok) { setStatus('标题已在别处更新，请刷新后重试'); return; }
      if (metadata && metadataRepository) await commands.updateMetadata({ ...metadata, updatedAt: Date.now() });
    } else await repository.update(bookmark.id, { title });
    setStatus('详情已保存');
  };
  return <form onSubmit={(event) => { event.preventDefault(); void save(); }}>{thumbnailRepository ? <ThumbnailPreview bookmarkId={bookmark.id} url={bookmark.url} repository={thumbnailRepository} onRefresh={() => onRefreshThumbnail?.(bookmark)}/> : null}<label>标题<input value={title} onChange={(event) => setTitle(event.target.value)}/></label><label>网址<input value={bookmark.url ?? ''} readOnly/></label>{metadata ? <><label>标签<input value={metadata.tags.join('，')} onChange={(event) => setMetadata({ ...metadata, tags: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })}/></label><label>摘要<textarea value={metadata.summary} onChange={(event) => setMetadata({ ...metadata, summary: event.target.value })}/></label><MarkdownNoteEditor initialValue={metadata.note} onSave={(note) => setMetadata({ ...metadata, note })}/><dl className="detail-status"><div><dt>AI 置信度</dt><dd>{metadata.confidence}</dd></div><div><dt>链接状态</dt><dd>{metadata.health}</dd></div></dl></> : null}<button type="submit">保存详情</button><output>{status}</output></form>;
}
