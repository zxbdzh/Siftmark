import { readBlobText } from './blob';
import { createImportGraph } from './import-graph';
import type { ImportGraph, ImportNode } from './types';

const SUPPORTED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'ftp:',
  'file:',
  'chrome:',
  'edge:',
  'about:',
  'mailto:'
]);

const ROOT_ALIASES = new Map<string, string>([
  ...[
    'bookmark bar',
    'bookmarks bar',
    'bookmark toolbar',
    'bookmarks toolbar',
    'favorites bar',
    'toolbar',
    '书签栏',
    '书签工具栏',
    '收藏夹栏',
    '收藏栏'
  ].map((alias) => [normalizeAlias(alias), '书签栏'] as const),
  ...[
    'other bookmarks',
    'other favorites',
    'other',
    '其他书签',
    '其它书签',
    '其他收藏夹',
    '其它收藏夹'
  ].map((alias) => [normalizeAlias(alias), '其他书签'] as const),
  ...[
    'mobile bookmarks',
    'mobile favorites',
    'mobile',
    '移动书签',
    '手机书签',
    '移动收藏夹'
  ].map((alias) => [normalizeAlias(alias), '移动书签'] as const)
]);

export async function parseNetscapeBookmarkFile(
  file: Blob
): Promise<ImportGraph> {
  return parseNetscapeBookmarkHtml(await readBlobText(file));
}

export function parseNetscapeBookmarkHtml(html: string): ImportGraph {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const rootList = document.querySelector('dl');
  if (!rootList) throw new Error('bookmark-html-list-missing');

  const nodes: ImportNode[] = [];
  let nextId = 0;

  const parseList = (list: Element, parentSourceId: string | null): void => {
    const children = Array.from(list.children);
    for (let position = 0; position < children.length; position += 1) {
      const child = children[position];
      if (!child) continue;
      const entry = findEntry(child);
      if (!entry) continue;

      const sourceId = `html-${nextId++}`;
      const index = countSiblings(nodes, parentSourceId);
      if (entry.tagName === 'A') {
        const url = validateBookmarkUrl(entry.getAttribute('href') ?? '');
        nodes.push({
          sourceId,
          kind: 'bookmark',
          parentSourceId,
          title: cleanTitle(readEntryText(entry), url),
          url,
          index
        });
        continue;
      }

      const title = normalizeRootTitle(
        cleanTitle(readEntryText(entry), '未命名文件夹'),
        parentSourceId
      );
      nodes.push({ sourceId, kind: 'folder', parentSourceId, title, index });
      const nestedList = findNestedList(child, children, position);
      if (nestedList.element) parseList(nestedList.element, sourceId);
      position = nestedList.consumedSibling ? position + 1 : position;
    }
  };

  parseList(rootList, null);
  if (nodes.length === 0) throw new Error('bookmark-html-empty');
  return createImportGraph({ format: 'netscape-html', version: 1, nodes });
}

export function normalizeBookmarkRootTitle(title: string): string {
  return ROOT_ALIASES.get(normalizeAlias(title)) ?? title;
}

export function validateBookmarkUrl(value: string): string {
  const url = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid-bookmark-url');
  }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol))
    throw new Error('unsupported-bookmark-url');
  return url;
}

function findEntry(element: Element): Element | null {
  if (element.tagName === 'A' || element.tagName === 'H3') return element;
  if (element.tagName !== 'DT') return null;
  return (
    Array.from(element.children).find(
      (child) => child.tagName === 'A' || child.tagName === 'H3'
    ) ?? null
  );
}

function findNestedList(
  container: Element,
  siblings: Element[],
  position: number
): { element: Element | null; consumedSibling: boolean } {
  const direct = Array.from(container.children).find(
    (child) => child.tagName === 'DL'
  );
  if (direct) return { element: direct, consumedSibling: false };
  const descendant = container.querySelector('dl');
  if (descendant) return { element: descendant, consumedSibling: false };
  const next = siblings[position + 1];
  return next?.tagName === 'DL'
    ? { element: next, consumedSibling: true }
    : { element: null, consumedSibling: false };
}

function cleanTitle(value: string | null, fallback: string): string {
  return value?.replace(/\s+/g, ' ').trim() || fallback;
}

function readEntryText(entry: Element): string {
  const clone = entry.cloneNode(true) as Element;
  clone
    .querySelectorAll('dl, script, style')
    .forEach((element) => element.remove());
  return clone.textContent ?? '';
}

function normalizeRootTitle(
  title: string,
  parentSourceId: string | null
): string {
  return parentSourceId === null ? normalizeBookmarkRootTitle(title) : title;
}

function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, '');
}

function countSiblings(
  nodes: ImportNode[],
  parentSourceId: string | null
): number {
  let count = 0;
  for (const node of nodes)
    if (node.parentSourceId === parentSourceId) count += 1;
  return count;
}
