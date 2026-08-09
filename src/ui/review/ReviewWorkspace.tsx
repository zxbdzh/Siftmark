import { Bot, Settings2 } from 'lucide-react';
import { useState } from 'react';
import type { AnalysisProposal } from '../../ai/proposal';
import { ProposalEditor } from './ProposalEditor';
import { ReviewFilters, type ReviewFilter } from './ReviewFilters';

export function ReviewWorkspace({
  proposals,
  onApply,
  onReject,
  onRetry,
  aiReady = true,
  onConfigureAi
}: {
  proposals: AnalysisProposal[];
  onApply(
    id: string,
    fields: Array<'title' | 'folder' | 'tags' | 'summary'>
  ): Promise<void> | void;
  onReject(id: string): Promise<void> | void;
  onRetry?(proposal: AnalysisProposal): Promise<void> | void;
  aiReady?: boolean;
  onConfigureAi?(): void;
}) {
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const visible = proposals.filter((proposal) =>
    filter === 'pending'
      ? proposal.state === 'pending'
      : filter === 'low'
        ? proposal.state === 'pending' && proposal.result.confidence === 'low'
        : proposal.state === filter
  );
  const runBatch = async (action: 'apply' | 'reject') => {
    if (
      visible.length === 0 ||
      (action === 'reject' &&
        !globalThis.confirm?.(`拒绝当前筛选中的 ${visible.length} 个提案？`))
    )
      return;
    setBusy(true);
    let completed = 0;
    try {
      for (const proposal of visible) {
        if (action === 'apply')
          await onApply(
            proposal.id,
            proposal.category === 'duplicate' || proposal.category === 'dead'
              ? []
              : ['title', 'folder', 'tags', 'summary']
          );
        else await onReject(proposal.id);
        completed += 1;
      }
      setStatus(
        `已${action === 'apply' ? '接受' : '拒绝'} ${completed} 个提案`
      );
    } finally {
      setBusy(false);
    }
  };
  const retryVisible = async () => {
    if (!onRetry) return;
    setBusy(true);
    try {
      for (const proposal of visible) await onRetry(proposal);
      setStatus(`已重新排队 ${visible.length} 个项目`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="review-workspace">
      <ReviewFilters value={filter} onChange={setFilter} />
      {visible.length ? (
        <>
          <div className="review-batch-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBatch('apply')}
            >
              接受当前 {visible.length} 项
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBatch('reject')}
            >
              拒绝当前 {visible.length} 项
            </button>
            {filter === 'failed' && onRetry ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retryVisible()}
              >
                重新运行当前 {visible.length} 项
              </button>
            ) : null}
          </div>
          {visible.map((proposal) => (
            <ProposalEditor
              key={proposal.id}
              proposal={proposal}
              onApply={(fields) => onApply(proposal.id, fields)}
              onReject={() => onReject(proposal.id)}
            />
          ))}
        </>
      ) : !aiReady ? (
        <div className="review-empty-state">
          <Bot size={22} />
          <div>
            <h2>尚未启用 AI</h2>
            <p>配置并验证模型后，即可生成书签分类、重命名和摘要提案。</p>
          </div>
          <button type="button" onClick={onConfigureAi}>
            <Settings2 size={16} />
            配置 AI
          </button>
        </div>
      ) : (
        <div className="review-empty-state">
          <Bot size={22} />
          <div>
            <h2>暂无待审核结果</h2>
            <p>
              {filter === 'pending'
                ? '在书签列表中打开右键菜单并选择“AI 分析”，结果会出现在这里。'
                : '当前筛选条件下没有审核记录。'}
            </p>
          </div>
        </div>
      )}
      <output>{status}</output>
    </div>
  );
}
