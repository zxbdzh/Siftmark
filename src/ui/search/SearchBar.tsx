import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BookmarkNode } from '../../bookmarks/types';
import type { SearchResult, SearchFilters as FilterValue } from '../../search/types';
import type { SearchService } from '../../search/search-service';
import { SearchFilters } from './SearchFilters';

export function SearchBar({ service, folders, onResults, onSelectResult }: { service: SearchService; folders?: BookmarkNode[]; onResults(results?: SearchResult[]): void; onSelectResult?(bookmarkId: string): void }) {
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<FilterValue>({});
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const hasFilters = Object.values(filters).some(Boolean);
    if (!text.trim() && !hasFilters) { setResults([]); onResults(undefined); return; }
    let current = true;
    const timer = globalThis.setTimeout(() => { void service.search({ text, filters }).then((next) => { if (!current) return; setResults(next); setActive(0); onResults(next); }); }, 180);
    return () => { current = false; globalThis.clearTimeout(timer); };
  }, [filters, onResults, service, text]);
  return <div className="search-control"><label><Search size={16}/><span className="sr-only">搜索书签</span><input value={text} placeholder="搜索标题、网址、标签、摘要和笔记" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.max(0, Math.min(results.length - 1, value + 1))); } else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); } else if (event.key === 'Enter' && results[active]) onSelectResult?.(results[active].bookmarkId); }}/></label><span aria-live="polite">{service.semanticEnabled ? '混合搜索' : '本地搜索'}{results.length > 0 ? ` · ${results.length} 项` : ''}</span><SearchFilters value={filters} folders={folders} onChange={setFilters}/></div>;
}
