const LATIN_TOKEN = /[\p{L}\p{N}]+/gu;
const HAN_RUN = /\p{Script=Han}+/gu;

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().normalize('NFD').replace(/\p{Mark}+/gu, '').trim();
}

export function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(LATIN_TOKEN)) {
    const token = match[0];
    if (/^\p{Script=Han}+$/u.test(token)) continue;
    tokens.add(token);
  }
  for (const match of normalized.matchAll(HAN_RUN)) {
    const run = match[0];
    if (run.length === 1) tokens.add(run);
    else for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return [...tokens];
}

export function editDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let edits = 0;
  for (let leftIndex = 0, rightIndex = 0; leftIndex < left.length || rightIndex < right.length;) {
    if (left[leftIndex] === right[rightIndex]) { leftIndex += 1; rightIndex += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else { leftIndex += 1; rightIndex += 1; }
  }
  return true;
}
