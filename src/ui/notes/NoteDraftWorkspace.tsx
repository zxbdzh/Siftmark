import { Copy, ExternalLink, Trash2 } from 'lucide-react';
import type { NoteDraft } from '../../notes/draft-repository';

export function NoteDraftWorkspace({ drafts, onDelete }: { drafts: NoteDraft[]; onDelete(id: string): void }) {
  return <section className="note-drafts" aria-labelledby="note-drafts-title"><h2 id="note-drafts-title">笔记草稿</h2>{drafts.length === 0 ? <p className="empty-state">暂无选中文本草稿</p> : <ul>{drafts.map((draft) => <li key={draft.id}><div><strong>{draft.title || '未命名页面'}</strong><p>{new Date(draft.createdAt).toLocaleString('zh-CN')}{draft.truncated ? ' · 已截断为 2,000 字符' : ''}</p></div><pre>{draft.text}</pre><div className="draft-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(draft.text)}><Copy size={16}/>复制</button>{draft.url ? <button type="button" onClick={() => void browser.tabs.create({ url: draft.url })}><ExternalLink size={16}/>打开来源</button> : null}<button type="button" onClick={() => onDelete(draft.id)}><Trash2 size={16}/>删除</button></div></li>)}</ul>}</section>;
}
