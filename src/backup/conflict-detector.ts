import type { BookmarkNode } from '../bookmarks/types';
import { isBookmark } from '../bookmarks/types';
import { normalizeUrlConservatively } from '../health/url-normalization';
import type { BookmarkMetadata } from '../storage/types';
import type { ImportDecision } from './import-plan';
import type { ImportGraph, ImportNode } from './types';

export type ImportConflictKind =
  | 'exact-url'
  | 'normalized-url'
  | 'folder-title'
  | 'duplicate-source-node'
  | 'metadata-only';

export interface ImportConflict {
  id: string;
  sourceId: string;
  kind: ImportConflictKind;
  existingBookmarkId?: string;
  mergeableFields?: Array<'tags' | 'note'>;
  defaultDecision: ImportDecision;
}

export function detectImportConflicts(
  graph: ImportGraph,
  existingNodes: BookmarkNode[],
  existingMetadata = new Map<string, BookmarkMetadata>()
): ImportConflict[] {
  const conflicts: ImportConflict[] = [];
  const seenSourceIds = new Set<string>();
  const existingBookmarks = existingNodes.filter(isBookmark);
  const existingFolders = existingNodes.filter((node) => !isBookmark(node));

  for (const node of graph.nodes) {
    if (seenSourceIds.has(node.sourceId)) {
      conflicts.push(createConflict(node, 'duplicate-source-node'));
      continue;
    }
    seenSourceIds.add(node.sourceId);

    if (node.kind === 'folder') {
      const folder = existingFolders.find(
        (candidate) =>
          normalizeTitle(candidate.title) === normalizeTitle(node.title)
      );
      if (folder)
        conflicts.push(createConflict(node, 'folder-title', folder.id));
      continue;
    }

    const exact = existingBookmarks.find(
      (candidate) => candidate.url === node.url
    );
    if (exact) {
      const mergeableFields = findMergeableFields(
        node,
        existingMetadata.get(exact.id)
      );
      conflicts.push(
        createConflict(
          node,
          mergeableFields.length > 0 ? 'metadata-only' : 'exact-url',
          exact.id,
          mergeableFields
        )
      );
      continue;
    }
    const normalizedUrl = normalizeUrlConservatively(node.url ?? '');
    const normalized = existingBookmarks.find(
      (candidate) => normalizeUrlConservatively(candidate.url) === normalizedUrl
    );
    if (normalized)
      conflicts.push(createConflict(node, 'normalized-url', normalized.id));
  }
  return conflicts;
}

function createConflict(
  node: ImportNode,
  kind: ImportConflictKind,
  existingBookmarkId?: string,
  mergeableFields?: Array<'tags' | 'note'>
): ImportConflict {
  return {
    id: `${kind}:${node.sourceId}`,
    sourceId: node.sourceId,
    kind,
    ...(existingBookmarkId ? { existingBookmarkId } : {}),
    ...(mergeableFields?.length ? { mergeableFields } : {}),
    defaultDecision: 'keep-existing'
  };
}

function findMergeableFields(
  node: ImportNode,
  existing: BookmarkMetadata | undefined
): Array<'tags' | 'note'> {
  if (!node.metadata) return [];
  const fields: Array<'tags' | 'note'> = [];
  if (
    Array.isArray(node.metadata.tags) &&
    JSON.stringify(node.metadata.tags) !== JSON.stringify(existing?.tags ?? [])
  ) {
    fields.push('tags');
  }
  if (
    typeof node.metadata.note === 'string' &&
    node.metadata.note !== (existing?.note ?? '')
  ) {
    fields.push('note');
  }
  return fields;
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}
