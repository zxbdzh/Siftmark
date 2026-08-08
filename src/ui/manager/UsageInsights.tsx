import type { BookmarkNode } from '../../bookmarks/types';
import type { VisitAggregate } from '../../storage/schema';

export function UsageInsights({ nodes, aggregates, now = Date.now() }: { nodes: BookmarkNode[]; aggregates: VisitAggregate[]; now?: number }) {
  const bookmarks = new Map(nodes.filter((node) => node.url).map((node) => [node.id, node]));
  const totalVisits = aggregates.reduce((sum, row) => sum + row.count, 0);
  const latestVisit = aggregates.reduce((latest, row) => Math.max(latest, row.lastVisitedAt ?? 0), 0);
  const domainCounts = new Map<string, number>();
  const daily = new Map<string, number>();
  for (const aggregate of aggregates) {
    const bookmark = bookmarks.get(aggregate.bookmarkId);
    const domain = domainOf(bookmark?.url);
    if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + aggregate.count);
    for (const [day, count] of Object.entries(aggregate.dailyBuckets)) daily.set(day, (daily.get(day) ?? 0) + count);
  }
  const frequentDomains = [...domainCounts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8);
  const trend = [...daily].sort(([left], [right]) => left.localeCompare(right)).slice(-30);
  const staleCount = nodes.filter((node) => node.url && now - (aggregates.find((row) => row.bookmarkId === node.id)?.lastVisitedAt ?? node.dateAdded ?? now) >= 90 * 86_400_000).length;
  return <section className="usage-insights"><header><h2>本地访问统计</h2></header><dl><div><dt>90 天访问</dt><dd>{totalVisits}</dd></div><div><dt>有访问记录</dt><dd>{aggregates.length}</dd></div><div><dt>最近访问</dt><dd>{latestVisit ? new Date(latestVisit).toLocaleString('zh-CN') : '暂无'}</dd></div><div><dt>清理建议</dt><dd>{staleCount} 项</dd></div></dl><div className="insights-columns"><section><h3>30 天趋势</h3>{trend.length ? <ol className="trend-list">{trend.map(([day, count]) => <li key={day}><span>{day.slice(5)}</span><meter min="0" max={Math.max(...trend.map(([, value]) => value))} value={count}/><strong>{count}</strong></li>)}</ol> : <p>暂无数据</p>}</section><section><h3>常用域名</h3>{frequentDomains.length ? <ol>{frequentDomains.map(([domain, count]) => <li key={domain}><span>{domain}</span><strong>{count}</strong></li>)}</ol> : <p>暂无数据</p>}</section></div></section>;
}

function domainOf(url?: string): string { try { return url ? new URL(url).hostname : ''; } catch { return ''; } }
