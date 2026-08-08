import type { ImportConflict } from './conflict-detector';
import type { ImportGraph, ImportNode } from './types';

export type ImportDecision =
  'skip' | 'keep-existing' | 'create-duplicate' | 'merge-metadata';

export interface ImportPlan {
  id: string;
  graph: ImportGraph;
  destinationParentId: string;
  conflicts: ImportConflict[];
  decisions: Record<string, ImportDecision>;
  orderedSourceIds: string[];
}

export function createImportPlan(
  graph: ImportGraph,
  conflicts: ImportConflict[],
  decisions: Record<string, ImportDecision> = {},
  destinationParentId: string,
  id: string = crypto.randomUUID()
): ImportPlan {
  const safeDecisions: Record<string, ImportDecision> = {};
  for (const conflict of conflicts) {
    safeDecisions[conflict.sourceId] =
      decisions[conflict.sourceId] ?? conflict.defaultDecision;
  }
  return {
    id,
    graph,
    destinationParentId,
    conflicts,
    decisions: safeDecisions,
    orderedSourceIds: orderParentFirst(graph.nodes)
  };
}

function orderParentFirst(nodes: ImportNode[]): string[] {
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
  const ordered: string[] = [];
  const visit = (parentSourceId: string | null): void => {
    for (const node of byParent.get(parentSourceId) ?? []) {
      ordered.push(node.sourceId);
      visit(node.sourceId);
    }
  };
  visit(null);
  if (ordered.length !== nodes.length)
    throw new Error('invalid-import-plan-graph');
  return ordered;
}
