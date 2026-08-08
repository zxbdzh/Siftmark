import type { BookmarkNode } from '../../bookmarks/types';
import type { SearchFilters as Filters } from '../../search/types';

export function SearchFilters({ value, folders = [], onChange }: { value: Filters; folders?: BookmarkNode[]; onChange(value: Filters): void }) {
  return <details className="search-filters"><summary>筛选</summary><div><label>文件夹<select value={value.folderId ?? ''} onChange={(event) => onChange({ ...value, folderId: event.target.value || undefined })}><option value="">全部</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title || '书签'}</option>)}</select></label><label>域名<input value={value.domain ?? ''} onChange={(event) => onChange({ ...value, domain: event.target.value.trim() || undefined })}/></label><label>标签<input value={value.tag ?? ''} onChange={(event) => onChange({ ...value, tag: event.target.value.trim() || undefined })}/></label><label>状态<select value={value.status ?? ''} onChange={(event) => onChange({ ...value, status: (event.target.value || undefined) as Filters['status'] })}><option value="">全部</option><option value="healthy">正常</option><option value="temporary">暂时不可达</option><option value="dead">永久失效</option><option value="restricted">登录受限</option><option value="blocked">检测受阻</option><option value="unchecked">未检查</option></select></label><label>创建时间从<input type="date" value={toDateValue(value.createdAfter)} onChange={(event) => onChange({ ...value, createdAfter: fromDateValue(event.target.value) })}/></label><label>创建时间至<input type="date" value={toDateValue(value.createdBefore)} onChange={(event) => onChange({ ...value, createdBefore: fromDateValue(event.target.value, true) })}/></label></div></details>;
}

function toDateValue(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromDateValue(value: string, endOfDay = false): number | undefined {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
}
