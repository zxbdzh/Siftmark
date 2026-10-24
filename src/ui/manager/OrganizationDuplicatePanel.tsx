import type { OrganizationDuplicateGroup } from '../../bookmarks/organization-duplicates';

export function OrganizationDuplicatePanel({
  groups,
  selections,
  onSelect,
  editable
}: {
  groups: OrganizationDuplicateGroup[];
  selections: Record<string, string>;
  onSelect: (groupId: string, bookmarkId: string) => void;
  editable: boolean;
}) {
  return (
    <section
      className="organize-review-panel"
      role="tabpanel"
      id="organize-duplicates-panel"
      aria-labelledby="organize-duplicates-tab"
    >
      <p>
        网址完全一致的每组保留一条。确认方案后，其余移入回收站；取消不改动。
      </p>
      {groups.map((group, index) => (
        <fieldset key={group.id} disabled={!editable}>
          <legend>
            重复组 {index + 1} · {group.bookmarks.length} 条
          </legend>
          {group.bookmarks.map((bookmark) => (
            <label className="organize-duplicate-option" key={bookmark.id}>
              <input
                type="radio"
                name={`duplicate-${group.id}`}
                value={bookmark.id}
                checked={
                  (selections[group.id] ?? group.keepBookmarkId) === bookmark.id
                }
                onChange={() => onSelect(group.id, bookmark.id)}
              />
              <span>
                <strong>{bookmark.title || '未命名书签'}</strong>
                <small>{bookmark.url}</small>
                <small>
                  {bookmark.dateAdded
                    ? new Date(bookmark.dateAdded).toLocaleString()
                    : '收藏时间未知'}{' '}
                  · {bookmark.id === group.id ? '默认保留：最早收藏' : '副本'}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </section>
  );
}
