import { describe, expect, it } from 'vitest';
import {
  exportBookmarksCsv,
  serializeBookmarksCsv
} from '../../../src/backup/csv-exporter';
import { readBlobText } from '../../../src/backup/blob';

describe('CSV export', () => {
  it('quotes structured fields and neutralizes spreadsheet formulas', async () => {
    const rows = [
      {
        title: '=HYPERLINK("https://evil.example")',
        url: 'https://example.com/a,b',
        folder: '+cmd',
        tags: ['normal', '@hidden'],
        summary: '-1+2',
        note: 'line 1\nline "2"'
      }
    ];

    const csv = serializeBookmarksCsv(rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""https://evil.example"")"');
    expect(csv).toContain('"https://example.com/a,b"');
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-1+2");
    expect(csv).toContain('"line 1\nline ""2"""');
    expect(await readBlobText(exportBookmarksCsv(rows))).toBe(csv.slice(1));
  });

  it('also protects cells whose formula marker follows whitespace', () => {
    const csv = serializeBookmarksCsv([
      { title: '  @SUM(A1)', url: 'https://example.com' }
    ]);
    expect(csv).toContain("'  @SUM(A1)");
  });
});
