import { useEffect, useState } from 'react';
import type { TaskRepository } from '../../tasks/task-repository';
import type { DurableTask } from '../../tasks/types';
import type { AnalysisProposal, ProposalRepository } from '../../ai/proposal';
import { AiStatusMark, type AiStatusState } from '../components/AiStatusMark';

const stateLabels: Record<string, string> = {
  queued: '等待分析',
  running: '正在分析',
  paused: '已暂停',
  succeeded: '分析完成',
  failed: '分析失败',
  unknown: '结果待确认',
  cancelled: '已取消'
};

export function TaskProgress({
  repository,
  taskId,
  bookmarkId,
  proposals
}: {
  repository: TaskRepository;
  taskId?: string;
  bookmarkId?: string;
  proposals?: ProposalRepository;
}) {
  const [task, setTask] = useState<DurableTask | null>(null);
  const [proposal, setProposal] = useState<AnalysisProposal>();
  useEffect(() => {
    if (!taskId) return;
    let active = true;
    const read = async () => {
      const [value, proposalRows] = await Promise.all([
        repository.get(taskId),
        proposals && bookmarkId ? proposals.list() : Promise.resolve([])
      ]);
      if (active) {
        setTask(value);
        setProposal(
          proposalRows.find((item) => item.bookmarkId === bookmarkId)
        );
      }
    };
    void read();
    const timer = globalThis.setInterval(() => void read(), 600);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [bookmarkId, proposals, repository, taskId]);
  if (!taskId) return null;
  const total = Math.max(task ? task.completed + task.failed : 1, 1);
  const proposalLabel =
    proposal?.state === 'pending'
      ? '等待审核'
      : proposal?.state === 'conflict'
        ? '存在冲突'
        : proposal?.state === 'failed'
          ? '分析失败'
          : proposal?.state === 'approved' ||
              proposal?.state === 'auto-approved'
            ? '分析完成'
            : undefined;
  const label =
    proposalLabel ??
    (task ? (stateLabels[task.state] ?? task.state) : '正在创建任务');
  const markState: AiStatusState = !task
    ? 'idle'
    : task.state === 'succeeded'
      ? 'success'
      : ['paused', 'failed', 'unknown', 'cancelled'].includes(task.state)
        ? 'paused'
        : 'analyzing';
  return (
    <section aria-label="任务进度" className="task-progress">
      <progress max={total} value={task?.completed ?? 0} />
      <div className="task-progress-status">
        <AiStatusMark state={markState} label={label} />
        <span>
          {label} · {task?.completed ?? 0}/{total}
        </span>
      </div>
    </section>
  );
}
