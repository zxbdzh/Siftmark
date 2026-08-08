export const MAX_CAPTURE_CHARACTERS = 12_000;

export function truncateByParagraph(text: string, maximum = MAX_CAPTURE_CHARACTERS): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((paragraph) => paragraph.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const full = normalized.join('\n\n');
  if (full.length <= maximum) return { text: full, truncated: false };
  const selected: string[] = [];
  let length = 0;
  for (const paragraph of normalized) {
    const separator = selected.length > 0 ? 2 : 0;
    if (length + separator + paragraph.length > maximum) break;
    selected.push(paragraph);
    length += separator + paragraph.length;
  }
  if (selected.length > 0) return { text: selected.join('\n\n'), truncated: true };
  return { text: full.slice(0, maximum).trimEnd(), truncated: true };
}
