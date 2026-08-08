import { useState } from 'react';
import type { AnalysisProposal } from '../../ai/proposal';
import { ProposalEditor } from './ProposalEditor';
import { ReviewFilters, type ReviewFilter } from './ReviewFilters';

export function ReviewWorkspace({ proposals, onApply, onReject }: { proposals: AnalysisProposal[]; onApply(id: string, fields: Array<'title' | 'folder' | 'tags' | 'summary'>): void; onReject(id: string): void }) {
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const visible = proposals.filter((proposal) => filter === 'pending' ? proposal.state === 'pending' : filter === 'low' ? proposal.result.confidence === 'low' : proposal.state === filter);
  return <div className="review-workspace"><ReviewFilters value={filter} onChange={setFilter}/>{visible.length ? visible.map((proposal) => <ProposalEditor key={proposal.id} proposal={proposal} onApply={(fields) => onApply(proposal.id, fields)} onReject={() => onReject(proposal.id)}/>) : <p>当前筛选下没有项目</p>}</div>;
}
