import type { ImportGraph, ImportNode } from './types';

export function validateImportGraph(graph: ImportGraph): ImportGraph {
  const byId = new Map<string, ImportNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.sourceId))
      throw new Error(`duplicate-source-node:${node.sourceId}`);
    if (node.kind === 'bookmark') {
      if (!node.url) throw new Error(`missing-bookmark-url:${node.sourceId}`);
      try {
        new URL(node.url);
      } catch {
        throw new Error(`invalid-bookmark-url:${node.sourceId}`);
      }
    }
    byId.set(node.sourceId, node);
  }
  for (const node of graph.nodes)
    if (node.parentSourceId !== null && !byId.has(node.parentSourceId))
      throw new Error(`missing-parent:${node.sourceId}`);
  for (const node of graph.nodes) {
    const visited = new Set<string>();
    let current: ImportNode | undefined = node;
    while (current && current.parentSourceId !== null) {
      if (visited.has(current.sourceId))
        throw new Error(`cyclic-parent:${node.sourceId}`);
      visited.add(current.sourceId);
      current = byId.get(current.parentSourceId);
    }
  }
  return graph;
}

export function createImportGraph(
  input: Partial<ImportGraph> &
    Pick<ImportGraph, 'format' | 'version' | 'nodes'>
): ImportGraph {
  return validateImportGraph({
    format: input.format,
    version: input.version,
    nodes: input.nodes,
    operations: input.operations ?? [],
    settings: input.settings ?? {},
    history: input.history ?? [],
    blockedDomains: input.blockedDomains ?? [],
    unknownFields: input.unknownFields ?? [],
    integrity: input.integrity ?? 'unverified',
    keyPresence: input.keyPresence ?? 'none',
    thumbnailBytes: input.thumbnailBytes ?? 0
  });
}
