import { ExternalLink, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ChromeSmartBookmarkHistoryRepository,
  SmartBookmarkHistoryItem
} from '../../bookmarks/history-repository';

export function SmartBookmarkHistorySection({
  repository
}: {
  repository: ChromeSmartBookmarkHistoryRepository;
}) {
  const [items, setItems] = useState<SmartBookmarkHistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const load = useCallback(() => repository.list().then(setItems), [repository]);

  useEffect(() => {
    void load();
    const listener = (message: unknown) => {
      if (
        (message as { type?: string }).type ===
        'smart-bookmark-history-changed'
      )
        void load();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? items.filter((item) =>
          `${item.title} ${item.url} ${item.category}`
            .toLocaleLowerCase()
            .includes(needle)
        )
      : items;
  }, [items, query]);

  return (
    <section className="history-section">
      <div className="section-heading">
        <div>
          <h2>历史记录</h2>
          <p>最近的智能收藏结果仅保存在本机。</p>
        </div>
        <button
          type="button"
          disabled={items.length === 0}
          onClick={() => void repository.clear().then(() => setItems([]))}
        >
          <Trash2 size={16} />
          清空记录
        </button>
      </div>
      <label className="history-search">
        <span className="visually-hidden">搜索历史</span>
        <input
          type="search"
          value={query}
          placeholder="搜索标题、网址或分类"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {visible.length > 0 ? (
        <ul className="history-list">
          {visible.map((item) => (
            <li key={item.id}>
              <div className="history-main">
                <strong>{item.title}</strong>
                <span>{item.category || '书签栏'}</span>
                <small>
                  {new Date(item.timestamp).toLocaleString('zh-CN')} · {item.url}
                </small>
              </div>
              <div className="history-actions">
                <button
                  type="button"
                  className="icon-button"
                  title="打开网页"
                  aria-label={`打开 ${item.title}`}
                  onClick={() => void browser.tabs.create({ url: item.url })}
                >
                  <ExternalLink size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="删除记录"
                  aria-label={`删除 ${item.title} 的记录`}
                  onClick={() =>
                    void repository
                      .remove(item.id)
                      .then(() => setItems((current) => current.filter((row) => row.id !== item.id)))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          {query ? '没有匹配的收藏记录' : '完成一次智能收藏后，结果会显示在这里'}
        </div>
      )}
    </section>
  );
}
