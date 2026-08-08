import { useMemo, useState } from 'react';
import { sanitizeMarkdown } from '../markdown/sanitize-markdown';

export function MarkdownNoteEditor({ initialValue = '', onSave }: { initialValue?: string; onSave(value: string): void }) {
  const [value, setValue] = useState(initialValue);
  const preview = useMemo(() => sanitizeMarkdown(value), [value]);
  return <section><label>笔记<textarea value={value} onChange={(event) => setValue(event.target.value)}/></label><pre aria-label="笔记预览">{preview}</pre><button type="button" onClick={() => onSave(value)}>保存笔记</button></section>;
}
