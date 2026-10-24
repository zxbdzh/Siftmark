import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { OrganizationReviewRecord } from '../../bookmarks/organization-review';
import { OrganizationSimilarityPanel } from './OrganizationSimilarityPanel';

export function OrganizationReviewDialog({
  records,
  busy,
  error,
  onClose,
  onResolve
}: {
  records: OrganizationReviewRecord[];
  busy: boolean;
  error?: string;
  onClose: () => void;
  onResolve: (id: string, keepBookmarkId?: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<{
    id: string;
    keepBookmarkId: string;
  }>();
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) {
      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');
    }
  }, []);
  const record = records.find((row) => row.id === selection?.id);
  const keeper = record?.bookmarks.find(
    (bookmark) => bookmark.id === selection?.keepBookmarkId
  );
  const victim = record?.bookmarks.find(
    (bookmark) => bookmark.id !== selection?.keepBookmarkId
  );
  return (
    <dialog
      ref={dialog}
      className="organize-review-dialog"
      aria-labelledby="organize-similarities-tab"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <h2 id="organize-similarities-tab">相似项审核</h2>
          <p>
            {
              records.filter((row) => ['pending', 'failed'].includes(row.state))
                .length
            }{' '}
            对待处理 · 默认全部保留
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label="关闭相似项审核"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <OrganizationSimilarityPanel
        records={records}
        disabled={busy || Boolean(selection)}
        onResolve={(id, keepBookmarkId) => {
          if (keepBookmarkId) setSelection({ id, keepBookmarkId });
          else void onResolve(id);
        }}
      />
      <footer>
        {error ? <p role="alert">{error}</p> : null}
        {selection && keeper && victim ? (
          <>
            <p>
              保留「{keeper.title}」，回收「{victim.title}」。将先下载完整 HTML
              备份，回收后可从回收站恢复。
            </p>
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelection(undefined)}
              >
                取消，全部保留
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  void onResolve(selection.id, selection.keepBookmarkId)
                    .then(() => setSelection(undefined))
                    .catch(() => undefined);
                }}
              >
                {busy ? '备份并处理…' : '备份并回收另一条'}
              </button>
            </div>
          </>
        ) : (
          <p>
            {busy
              ? '正在保存处理结果…'
              : '只记录判断依据，不会自动删除相似项。'}
          </p>
        )}
      </footer>
    </dialog>
  );
}
