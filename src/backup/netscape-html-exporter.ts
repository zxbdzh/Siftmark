import type { ImportNode } from './types';

export function exportNetscapeBookmarkHtml(
  nodes: ImportNode[],
  title = 'Siftmark 书签'
): Blob {
  return new Blob([serializeNetscapeBookmarkHtml(nodes, title)], {
    type: 'text/html;charset=utf-8'
  });
}

export function serializeNetscapeBookmarkHtml(
  nodes: ImportNode[],
  title = 'Siftmark 书签'
): string {
  const byParent = new Map<string | null, ImportNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentSourceId) ?? [];
    siblings.push(node);
    byParent.set(node.parentSourceId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(
      (left, right) =>
        left.index - right.index || left.sourceId.localeCompare(right.sourceId)
    );
  }

  const escapedTitle = escapeHtml(title);
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n',
    `<TITLE>${escapedTitle}</TITLE>\n`,
    `<H1>${escapedTitle}</H1>\n`,
    '<DL><p>\n',
    serializeChildren(null, byParent, 1),
    '</DL><p>\n'
  ].join('');
}

function serializeChildren(
  parentSourceId: string | null,
  byParent: Map<string | null, ImportNode[]>,
  depth: number
): string {
  const indentation = '  '.repeat(depth);
  return (byParent.get(parentSourceId) ?? [])
    .map((node) => {
      if (node.kind === 'bookmark') {
        return `${indentation}<DT><A HREF="${escapeHtml(node.url ?? '')}">${escapeHtml(node.title)}</A>\n`;
      }
      return [
        `${indentation}<DT><H3>${escapeHtml(node.title)}</H3>\n`,
        `${indentation}<DL><p>\n`,
        serializeChildren(node.sourceId, byParent, depth + 1),
        `${indentation}</DL><p>\n`
      ].join('');
    })
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
