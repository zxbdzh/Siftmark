import { describe, expect, it } from 'vitest';
import { truncateByParagraph } from '../../../src/capture/truncate-content';

describe('truncateByParagraph', () => {
  it('prefers complete paragraphs below the 12,000-character ceiling', () => {
    const result = truncateByParagraph(`${'a'.repeat(7_000)}\n\n${'b'.repeat(6_000)}`);
    expect(result).toEqual({ text: 'a'.repeat(7_000), truncated: true });
  });

  it('hard truncates a single oversized paragraph', () => {
    expect(truncateByParagraph('x'.repeat(13_000)).text).toHaveLength(12_000);
  });
});
