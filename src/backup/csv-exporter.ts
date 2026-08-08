export interface BookmarkCsvRow {
  title: string;
  url: string;
  folder?: string;
  tags?: string[] | string;
  summary?: string;
  note?: string;
}

const HEADERS = ['标题', 'URL', '文件夹', '标签', '摘要', '笔记'];
const FORMULA_PREFIX = /^\s*[=+\-@]/;

export function exportBookmarksCsv(rows: BookmarkCsvRow[]): Blob {
  return new Blob([serializeBookmarksCsv(rows)], {
    type: 'text/csv;charset=utf-8'
  });
}

export function serializeBookmarksCsv(rows: BookmarkCsvRow[]): string {
  const lines = [HEADERS, ...rows.map(toCells)].map((cells) =>
    cells.map(escapeCsvCell).join(',')
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function toCells(row: BookmarkCsvRow): string[] {
  return [
    row.title,
    row.url,
    row.folder ?? '',
    Array.isArray(row.tags) ? row.tags.join(' | ') : (row.tags ?? ''),
    row.summary ?? '',
    row.note ?? ''
  ];
}

function escapeCsvCell(input: string): string {
  const value = FORMULA_PREFIX.test(input) ? `'${input}` : input;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
