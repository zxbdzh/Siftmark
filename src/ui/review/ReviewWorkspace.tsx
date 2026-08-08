import { useState } from 'react';
import type { AnalysisProposal } from '../../ai/proposal';
import { ProposalEditor } from './ProposalEditor';
import { ReviewFilters, type ReviewFilter } from './ReviewFilters';

export function ReviewWorkspace({ proposals, onApply, onReject, onRetry }: { proposals: AnalysisProposal[]; onApply(id: string, fields: Array<'title' | 'folder' | 'tags' | 'summary'>): Promise<void> | void; onReject(id: string): Promise<void> | void; onRetry?(proposal: AnalysisProposal): Promise<void> | void }) {
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const visible = proposals.filter((proposal) => filter === 'pending' ? proposal.state === 'pending' : filter === 'low' ? proposal.state === 'pending' && proposal.result.confidence === 'low' : proposal.state === filter);
  const runBatch = async (action: 'apply' | 'reject') => {
    if (visible.length === 0 || (action === 'reject' && !globalThis.confirm?.(`拒绝当前筛选中的 ${visible.length} 个提案？`))) return;
    setBusy(true);
    let completed = 0;
    try {
      for (const proposal of visible) {
        if (action === 'apply') await onApply(proposal.id, proposal.category === 'duplicate' || proposal.category === 'dead' ? [] : ['title', 'folder', 'tags', 'summary']);
        else await onReject(proposal.id);
        completed += 1;
      }
      setStatus(`已${action === 'apply' ? '接受' : '拒绝'} ${completed} 个提案`);
    } finally { setBusy(false); }
  };
  const retryVisible = async () => {
    if (!onRetry) return;
    setBusy(true);
    try { for (const proposal of visible) await onRetry(proposal); setStatus(`已重新排队 ${visible.length} 个项目`); }
    finally { setBusy(false); }
  };
  return <div className="review-workspace"><ReviewFilters value={filter} onChange={setFilter}/>{visible.length ? <><div className="review-batch-actions"><button type="button" disabled={busy} onClick={() => void runBatch('apply')}>接受当前 {visible.length} 项</button><button type="button" disabled={busy} onClick={() => void runBatch('reject')}>拒绝当前 {visible.length} 项</button>{filter === 'failed' && onRetry ? <button type="button" disabled={busy} onClick={() => void retryVisible()}>重新运行当前 {visible.length} 项</button> : null}</div>{visible.map((proposal) => <ProposalEditor key={proposal.id} proposal={proposal} onApply={(fields) => onApply(proposal.id, fields)} onReject={() => onReject(proposal.id)}/>)}</> : <p>当前筛选下没有项目</p>}<output>{status}</output></div>;
}
