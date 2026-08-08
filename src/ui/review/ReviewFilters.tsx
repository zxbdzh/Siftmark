export type ReviewFilter = 'pending' | 'low' | 'conflict' | 'failed' | 'duplicate' | 'dead';
export function ReviewFilters({ value, onChange }: { value: ReviewFilter; onChange(value: ReviewFilter): void }) {
  return <nav aria-label="审核筛选">{([['pending','待审核'],['low','低置信度'],['conflict','冲突'],['failed','失败'],['duplicate','重复'],['dead','失效']] as const).map(([id, label]) => <button type="button" aria-pressed={value === id} key={id} onClick={() => onChange(id)}>{label}</button>)}</nav>;
}
