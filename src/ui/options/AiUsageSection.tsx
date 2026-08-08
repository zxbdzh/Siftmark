import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { UsageRepository } from '../../ai/network/usage-repository';
import type { RequestMetric } from '../../ai/network/request-metrics';

export function AiUsageSection({ metrics, repository, onClear }: { metrics: RequestMetric[]; repository?: UsageRepository; onClear?(): void }) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => metrics.filter((metric) => !filter || metric.model.toLocaleLowerCase().includes(filter.toLocaleLowerCase()) || metric.taskType.toLocaleLowerCase().includes(filter.toLocaleLowerCase())), [filter, metrics]);
  const tokens = metrics.reduce((sum, metric) => sum + (metric.tokens ?? 0), 0);
  return <section><h2>本地 AI 用量</h2><p>请求 {metrics.length} 次 · Token {tokens}，仅保存在本地，不上传遥测。</p><label className="stacked-field">筛选<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="模型或任务类型"/></label><div className="table-scroll"><table><thead><tr><th>模型</th><th>任务</th><th>Token</th><th>耗时</th><th>状态</th></tr></thead><tbody>{visible.map((metric) => <tr key={metric.requestId}><td>{metric.model}</td><td>{metric.taskType}</td><td>{metric.tokens ?? '—'}</td><td>{metric.latency}ms</td><td>{metric.status}</td></tr>)}</tbody></table></div><button type="button" disabled={!repository || metrics.length === 0} onClick={() => void repository?.clear().then(() => onClear?.())}><Trash2 size={16}/>清除本地用量记录</button></section>;
}
