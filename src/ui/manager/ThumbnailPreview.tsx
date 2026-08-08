import { ExternalLink, ImageOff, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ThumbnailRepository } from '../../storage/thumbnail-repository';
import type { ThumbnailRecord } from '../../storage/schema';

export function ThumbnailPreview({ bookmarkId, url, repository, onRefresh }: { bookmarkId: string; url?: string; repository: ThumbnailRepository; onRefresh?(): void }) {
  const [record, setRecord] = useState<ThumbnailRecord | null>(null);
  const [objectUrl, setObjectUrl] = useState<string>();
  const [open, setOpen] = useState(false);
  useEffect(() => { let active = true; void repository.get(bookmarkId).then((value) => { if (active) setRecord(value); }); return () => { active = false; }; }, [bookmarkId, repository]);
  useEffect(() => { if (!record?.blob) { setObjectUrl(undefined); return; } const next = URL.createObjectURL(record.blob); setObjectUrl(next); return () => URL.revokeObjectURL(next); }, [record?.blob]);
  return <section className="thumbnail-preview" aria-label="网页缩略图">{objectUrl ? <button type="button" className="thumbnail-image-button" onClick={() => setOpen(true)}><img src={objectUrl} alt="网页缩略图"/></button> : <div className="thumbnail-fallback"><ImageOff size={20}/><span>{record?.state === 'failed' ? '缩略图捕获失败' : record?.state === 'capturing' ? '正在捕获缩略图' : '暂无缩略图'}</span></div>}<p>{record?.createdAt ? `捕获于 ${new Date(record.createdAt).toLocaleString('zh-CN')}` : '保存书签后可捕获当前可见页面'}</p><div className="form-actions"><button type="button" onClick={onRefresh}><RefreshCw size={15}/>刷新缩略图</button>{url ? <button type="button" onClick={() => void browser.tabs.create({ url })}><ExternalLink size={15}/>打开网页</button> : null}</div>{open && objectUrl ? <div role="dialog" aria-modal="true" aria-label="缩略图预览" className="thumbnail-modal"><button type="button" aria-label="关闭缩略图预览" onClick={() => setOpen(false)}><X/></button><img src={objectUrl} alt="网页缩略图全图"/></div> : null}</section>;
}
