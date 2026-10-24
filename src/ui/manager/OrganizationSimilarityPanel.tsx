import type { OrganizationReviewRecord } from '../../bookmarks/organization-review';

export function OrganizationSimilarityPanel({
  records,
  disabled = false,
  onResolve
}: {
  records: OrganizationReviewRecord[];
  disabled?: boolean;
  onResolve?: (id: string, keepBookmarkId?: string) => void;
}) {
  return (
    <section
      className="organize-review-panel"
      role="tabpanel"
      id="organize-similarities-panel"
      aria-labelledby="organize-similarities-tab"
    >
      <p>
        相似不等于重复。默认全部保留，建议与依据已保存在本机，可稍后处理。保留一条会先下载完整备份，再将另一条移入回收站。
      </p>
      {!records.length ? (
        <p>暂未发现需要审核的相似项。</p>
      ) : (
        records.map((record) => (
          <article key={record.id} className="organize-similarity-row">
            <header>
              <strong>
                {record.state === 'pending'
                  ? '待处理 · 全部保留'
                  : record.state === 'kept-all'
                    ? '已决定全部保留'
                    : record.state === 'kept-one'
                      ? '已保留一条，其余已回收'
                      : '处理未完成'}
              </strong>
              <span>
                模型自评：
                {record.confidence === 'high'
                  ? '较确定'
                  : record.confidence === 'medium'
                    ? '一般'
                    : '不确定'}
              </span>
            </header>
            <p>{record.reason}</p>
            {record.bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="organize-similarity-bookmark">
                <span>
                  <strong>{bookmark.title || '未命名书签'}</strong>
                  <a href={bookmark.url} target="_blank" rel="noreferrer">
                    {bookmark.url}
                  </a>
                </span>
                {onResolve && ['pending', 'failed'].includes(record.state) ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onResolve(record.id, bookmark.id)}
                    aria-label={`保留 ${bookmark.title}，回收另一条`}
                  >
                    保留这一条
                  </button>
                ) : null}
              </div>
            ))}
            {record.error ? <p role="alert">{record.error}</p> : null}
            {onResolve && ['pending', 'failed'].includes(record.state) ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onResolve(record.id)}
              >
                全部保留
              </button>
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}
