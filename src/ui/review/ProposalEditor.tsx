import { useState } from 'react';
import type { AnalysisProposal } from '../../ai/proposal';

export function ProposalEditor({ proposal, onApply, onReject }: { proposal: AnalysisProposal; onApply(fields: Array<'title' | 'folder' | 'tags' | 'summary'>): void; onReject(): void }) {
  const [fields, setFields] = useState(new Set<'title' | 'folder' | 'tags' | 'summary'>(['title', 'folder', 'tags', 'summary']));
  const toggle = (field: 'title' | 'folder' | 'tags' | 'summary') => setFields((current) => { const next = new Set(current); if (next.has(field)) next.delete(field); else next.add(field); return next; });
  return <section aria-label={`审核 ${proposal.sourceSnapshot.title}`}><h3>{proposal.result.title}</h3><p>{proposal.result.confidence === 'high' ? '高置信度' : proposal.result.confidence === 'medium' ? '中置信度' : '低置信度'} · {proposal.result.reason}</p>{(['title','folder','tags','summary'] as const).map((field) => <label key={field}><input type="checkbox" checked={fields.has(field)} onChange={() => toggle(field)}/>{field}</label>)}<button type="button" onClick={() => onApply([...fields])}>应用所选字段</button><button type="button" onClick={onReject}>拒绝</button></section>;
}
