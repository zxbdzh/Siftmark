import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BookmarkRepository } from '../../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../../bookmarks/types';
import type { Rule, RuleAction } from '../../rules/types';
import type { ChromeSettingsRepository } from '../../settings/settings-repository';

type ActionType = RuleAction['type'];
interface RuleDraft {
  name: string;
  priority: number;
  domain: string;
  urlPrefix: string;
  titleIncludes: string;
  sourceFolderId: string;
  actionType: ActionType;
  actionValue: string;
}

const blankDraft: RuleDraft = { name: '', priority: 0, domain: '', urlPrefix: '', titleIncludes: '', sourceFolderId: '', actionType: 'skip-ai', actionValue: '' };

export function RulesSection({ repository, bookmarks }: { repository?: ChromeSettingsRepository; bookmarks?: BookmarkRepository }) {
  const [draft, setDraft] = useState(blankDraft);
  const [editingId, setEditingId] = useState<string>();
  const [rules, setRules] = useState<Rule[]>([]);
  const [folders, setFolders] = useState<BookmarkNode[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => { if (repository) void repository.getRules().then(setRules); }, [repository]);
  useEffect(() => { if (bookmarks) void bookmarks.getTree().then((nodes) => setFolders(nodes.filter((node) => !isBookmark(node)))); }, [bookmarks]);
  const persist = async (next: Rule[]) => { setRules(next); if (repository) await repository.setRules(next); setStatus('规则已保存'); };
  const reset = () => { setDraft(blankDraft); setEditingId(undefined); setStatus(''); };
  const save = async () => {
    const match = {
      ...(draft.domain.trim() ? { domain: draft.domain.trim().toLocaleLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') } : {}),
      ...(draft.urlPrefix.trim() ? { urlPrefix: draft.urlPrefix.trim() } : {}),
      ...(draft.titleIncludes.trim() ? { titleIncludes: draft.titleIncludes.trim() } : {}),
      ...(draft.sourceFolderId ? { sourceFolderId: draft.sourceFolderId } : {})
    };
    if (Object.keys(match).length === 0) { setStatus('至少填写一个匹配条件'); return; }
    let action: RuleAction;
    if (draft.actionType === 'move') {
      if (!draft.actionValue) { setStatus('请选择目标文件夹'); return; }
      action = { type: 'move', folderId: draft.actionValue };
    } else if (draft.actionType === 'tag') {
      if (!draft.actionValue.trim()) { setStatus('请输入标签'); return; }
      action = { type: 'tag', tag: draft.actionValue.trim() };
    } else action = { type: draft.actionType };
    const existing = editingId ? rules.find((rule) => rule.id === editingId) : undefined;
    const rule: Rule = { id: existing?.id ?? crypto.randomUUID(), name: draft.name.trim() || '未命名规则', priority: draft.priority, createdAt: existing?.createdAt ?? Date.now(), enabled: existing?.enabled ?? true, match, actions: [action] };
    await persist(existing ? rules.map((item) => item.id === existing.id ? rule : item) : [...rules, rule]);
    reset();
  };
  const edit = (rule: Rule) => {
    const action = rule.actions[0] ?? { type: 'skip-ai' as const };
    setEditingId(rule.id);
    setDraft({ name: rule.name, priority: rule.priority, domain: rule.match.domain ?? '', urlPrefix: rule.match.urlPrefix ?? '', titleIncludes: rule.match.titleIncludes ?? '', sourceFolderId: rule.match.sourceFolderId ?? '', actionType: action.type, actionValue: action.type === 'move' ? action.folderId : action.type === 'tag' ? action.tag : '' });
    setStatus(`正在编辑“${rule.name}”`);
  };
  return <section><h2>整理规则</h2><form onSubmit={(event) => { event.preventDefault(); void save(); }}><div className="settings-grid"><label>规则名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：开发文档"/></label><label>优先级<input type="number" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })}/></label><label>域名<input value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} placeholder="example.com"/></label><label>URL 前缀<input type="url" value={draft.urlPrefix} onChange={(event) => setDraft({ ...draft, urlPrefix: event.target.value })} placeholder="https://example.com/docs"/></label><label>标题包含<input value={draft.titleIncludes} onChange={(event) => setDraft({ ...draft, titleIncludes: event.target.value })}/></label><label>来源文件夹<select value={draft.sourceFolderId} onChange={(event) => setDraft({ ...draft, sourceFolderId: event.target.value })}><option value="">不限</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title || '书签'}</option>)}</select></label><label>执行动作<select value={draft.actionType} onChange={(event) => setDraft({ ...draft, actionType: event.target.value as ActionType, actionValue: '' })}><option value="move">移动到文件夹</option><option value="tag">添加标签</option><option value="skip-ai">跳过 AI</option><option value="send-to-inbox">发送到待整理箱</option></select></label>{draft.actionType === 'move' ? <label>目标文件夹<select value={draft.actionValue} onChange={(event) => setDraft({ ...draft, actionValue: event.target.value })}><option value="">请选择</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title || '书签'}</option>)}</select></label> : draft.actionType === 'tag' ? <label>标签<input value={draft.actionValue} onChange={(event) => setDraft({ ...draft, actionValue: event.target.value })}/></label> : null}</div><div className="form-actions"><button type="submit">{editingId ? '保存修改' : '添加规则'}</button>{editingId ? <button type="button" onClick={reset}><RotateCcw size={16}/>取消编辑</button> : null}</div><output>{status}</output></form><ul className="settings-list">{rules.map((rule) => <li key={rule.id}><label className="inline-control"><input type="checkbox" checked={rule.enabled} onChange={() => void persist(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))}/><span>{rule.name} · 优先级 {rule.priority}</span><span>{describeMatch(rule)}</span></label><div className="form-actions"><button type="button" className="icon-button" aria-label={`编辑 ${rule.name}`} onClick={() => edit(rule)}><Pencil size={16}/></button><button type="button" className="icon-button" aria-label={`删除 ${rule.name}`} onClick={() => void persist(rules.filter((item) => item.id !== rule.id))}><Trash2 size={16}/></button></div></li>)}</ul></section>;
}

function describeMatch(rule: Rule): string {
  return rule.match.domain ?? rule.match.urlPrefix ?? rule.match.titleIncludes ?? rule.match.sourceFolderId ?? '全部';
}
