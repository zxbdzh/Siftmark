import type { OrganizationBatchProgress } from '../../bookmarks/organization-planner';
import type { OrganizeStage } from '../../bookmarks/organize-bookmarks';

const labels = {
  reading: '通读',
  planning: '合并目录',
  assigning: '分配归属',
  reviewing: '相似复核'
};
const statuses = {
  queued: '等待执行',
  running: '等待模型响应',
  retrying: '等待重试',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

export function OrganizationActivityPanel({
  batches,
  now,
  concurrency,
  stage
}: {
  batches: OrganizationBatchProgress[];
  now: number;
  concurrency: number;
  stage: OrganizeStage;
}) {
  const active = batches.filter((batch) => batch.status === 'running').length;
  const completed = batches.filter(
    (batch) => batch.status === 'completed'
  ).length;
  return (
    <section
      className="organize-review-panel"
      role="tabpanel"
      id="organize-activity-panel"
      aria-labelledby="organize-activity-tab"
    >
      <div className="organize-activity-summary">
        <strong>
          {active} 批运行 · 并发上限 {concurrency}
        </strong>
        <span>
          {completed} / {batches.length} 批完成
        </span>
      </div>
      {batches.length ? (
        <table className="organize-activity-table">
          <thead>
            <tr>
              <th>批次</th>
              <th>书签</th>
              <th>状态</th>
              <th>耗时</th>
              <th>返回摘要</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id} data-status={batch.status}>
                <th scope="row">
                  {labels[batch.stage]} · {batch.batch}
                </th>
                <td>{batch.count ? `${batch.count} 条` : '全库主题'}</td>
                <td>
                  {statuses[batch.status]}
                  {batch.attempt > 1 ? ` · 第 ${batch.attempt} 次` : ''}
                  {batch.status === 'retrying' && batch.retryAfterMs
                    ? ` · ${Math.ceil(batch.retryAfterMs / 1000)} 秒后`
                    : ''}
                </td>
                <td>
                  {batch.startedAt
                    ? `${Math.max(0, Math.floor(((batch.finishedAt ?? now) - batch.startedAt) / 1000))} 秒`
                    : '—'}
                </td>
                <td>
                  {batch.error && batch.status === 'failed'
                    ? batch.error
                    : batch.summary ||
                      (batch.status === 'running' ? '模型尚未返回结果' : '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          {stage === 'backup'
            ? '完整备份下载中，尚未向模型发送数据'
            : '正在准备分析批次'}
        </p>
      )}
    </section>
  );
}
