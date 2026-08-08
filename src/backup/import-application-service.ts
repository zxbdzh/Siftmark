import type { BookmarkRepository } from '../bookmarks/ports';
import type { BookmarkNode } from '../bookmarks/types';
import type { BookmarkCommandService } from '../operations/bookmark-command-service';
import type { SiftmarkDatabase } from '../storage/database';
import type { BookmarkMetadata, MetadataRepository } from '../storage/types';
import type { TaskRepository } from '../tasks/task-repository';
import type { DurableTask } from '../tasks/types';
import type { ImportPlan } from './import-plan';
import type { ImportNode } from './types';

const RECOVERY_LIMIT = 5;

export interface ImportRecoveryPoint {
  id: string;
  createdAt: number;
  nodes: BookmarkNode[];
  metadata: BookmarkMetadata[];
}

export interface ImportRecoveryPointRepository {
  put(point: ImportRecoveryPoint): Promise<void>;
  list(): Promise<ImportRecoveryPoint[]>;
}

export interface BackupStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export class DexieImportRecoveryRepository implements ImportRecoveryPointRepository {
  constructor(private readonly database: SiftmarkDatabase) {}

  async put(point: ImportRecoveryPoint): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.importRecoveryPoints,
      async () => {
        await this.database.importRecoveryPoints.put(point);
        const all = await this.database.importRecoveryPoints
          .orderBy('createdAt')
          .reverse()
          .toArray();
        const expired = all.slice(RECOVERY_LIMIT);
        if (expired.length > 0) {
          await this.database.importRecoveryPoints.bulkDelete(
            expired.map((item) => item.id)
          );
        }
      }
    );
  }

  async list(): Promise<ImportRecoveryPoint[]> {
    return this.database.importRecoveryPoints
      .orderBy('createdAt')
      .reverse()
      .toArray();
  }
}

export interface ImportFailure {
  sourceId: string;
  message: string;
  at: number;
}

export interface ImportApplicationTaskInput {
  plan: ImportPlan;
  nextIndex: number;
  createdIds: Record<string, string>;
  recoveryPointId?: string;
  inFlightSourceId?: string;
  settingsApplied?: boolean;
  failures: ImportFailure[];
}

export interface ImportApplicationDependencies {
  bookmarks: BookmarkRepository;
  commands: BookmarkCommandService;
  metadata: MetadataRepository;
  tasks: TaskRepository;
  recoveryPoints: ImportRecoveryPointRepository;
  configuration?: BackupStorageArea;
  now?: () => number;
  createId?: () => string;
}

export function createImportTask(
  plan: ImportPlan,
  now = Date.now(),
  id: string = crypto.randomUUID()
): DurableTask<ImportApplicationTaskInput> {
  return {
    id,
    type: 'backup-import',
    state: 'queued',
    input: { plan, nextIndex: 0, createdIds: {}, failures: [] },
    completed: 0,
    failed: 0,
    retryCount: 0,
    idempotencyKey: `backup-import:${plan.id}`,
    createdAt: now,
    updatedAt: now
  };
}

export async function applyImportPlan(
  taskId: string,
  dependencies: ImportApplicationDependencies
): Promise<DurableTask<ImportApplicationTaskInput>> {
  const now = dependencies.now ?? Date.now;
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const stored = await dependencies.tasks.get(taskId);
  if (!stored || stored.type !== 'backup-import')
    throw new Error('import-task-not-found');
  let task = stored as DurableTask<ImportApplicationTaskInput>;
  if (task.state === 'succeeded') return task;
  await dependencies.tasks.update(task.id, {
    state: 'running',
    updatedAt: now()
  });

  let input = task.input;
  if (!input.recoveryPointId) {
    const [nodes, metadata] = await Promise.all([
      dependencies.bookmarks.getTree(),
      dependencies.metadata.list()
    ]);
    const recoveryPoint: ImportRecoveryPoint = {
      id: createId(),
      createdAt: now(),
      nodes,
      metadata
    };
    await dependencies.recoveryPoints.put(recoveryPoint);
    input = { ...input, recoveryPointId: recoveryPoint.id };
    await dependencies.tasks.update(task.id, { input, updatedAt: now() });
  }

  const bySourceId = new Map(
    input.plan.graph.nodes.map((node) => [node.sourceId, node])
  );
  while (input.nextIndex < input.plan.orderedSourceIds.length) {
    const sourceId = input.plan.orderedSourceIds[input.nextIndex];
    const node = sourceId ? bySourceId.get(sourceId) : undefined;
    if (!sourceId || !node) throw new Error('invalid-import-task-node');
    const decision = input.plan.decisions[sourceId] ?? 'create-duplicate';
    const recoveringInFlight =
      decision === 'create-duplicate' && input.inFlightSourceId === sourceId;
    if (decision === 'create-duplicate' && !recoveringInFlight) {
      input = { ...input, inFlightSourceId: sourceId };
      await dependencies.tasks.update(task.id, { input, updatedAt: now() });
    }
    try {
      input = await applyNode(
        node,
        input,
        dependencies,
        now,
        recoveringInFlight
      );
      task = {
        ...task,
        state: 'running',
        input,
        completed: input.nextIndex,
        updatedAt: now()
      };
      await dependencies.tasks.update(task.id, {
        input,
        completed: task.completed,
        updatedAt: task.updatedAt
      });
    } catch (error) {
      const failure: ImportFailure = {
        sourceId,
        message: error instanceof Error ? error.message : 'import-node-failed',
        at: now()
      };
      input = { ...input, failures: [...input.failures, failure] };
      task = {
        ...task,
        state: 'paused',
        input,
        completed: input.nextIndex,
        failed: task.failed + 1,
        updatedAt: now()
      };
      await dependencies.tasks.update(task.id, task);
      return task;
    }
  }

  if (!input.settingsApplied && dependencies.configuration) {
    try {
      const settings = Object.fromEntries(
        Object.entries(input.plan.graph.settings).filter(
          ([key]) =>
            key !== 'siftmark.ai.profiles.v1' ||
            input.plan.graph.keyPresence === 'encrypted'
        )
      );
      if (input.plan.graph.history.length > 0) {
        settings['siftmark.migration.history.v1'] = input.plan.graph.history;
      }
      if (input.plan.graph.blockedDomains.length > 0) {
        settings['siftmark.settings.blocked-domains.v1'] =
          input.plan.graph.blockedDomains;
      }
      if (Object.keys(settings).length > 0)
        await dependencies.configuration.set(settings);
      input = { ...input, settingsApplied: true };
      await dependencies.tasks.update(task.id, { input, updatedAt: now() });
    } catch (error) {
      const failure: ImportFailure = {
        sourceId: '__configuration__',
        message:
          error instanceof Error
            ? error.message
            : 'import-configuration-failed',
        at: now()
      };
      input = { ...input, failures: [...input.failures, failure] };
      task = {
        ...task,
        state: 'paused',
        input,
        completed: input.nextIndex,
        failed: task.failed + 1,
        updatedAt: now()
      };
      await dependencies.tasks.update(task.id, task);
      return task;
    }
  }

  task = {
    ...task,
    state: 'succeeded',
    input,
    completed: input.nextIndex,
    updatedAt: now()
  };
  await dependencies.tasks.update(task.id, task);
  return task;
}

async function applyNode(
  node: ImportNode,
  input: ImportApplicationTaskInput,
  dependencies: ImportApplicationDependencies,
  now: () => number,
  recoveringInFlight: boolean
): Promise<ImportApplicationTaskInput> {
  const conflict = input.plan.conflicts.find(
    (item) => item.sourceId === node.sourceId
  );
  const decision = input.plan.decisions[node.sourceId] ?? 'create-duplicate';
  const createdIds = { ...input.createdIds };

  if (decision === 'skip' || decision === 'keep-existing') {
    if (conflict?.existingBookmarkId)
      createdIds[node.sourceId] = conflict.existingBookmarkId;
    return finishNode(input, createdIds);
  }
  if (decision === 'merge-metadata') {
    if (!conflict?.existingBookmarkId)
      throw new Error('missing-import-conflict-target');
    await mergeMetadata(node, conflict.existingBookmarkId, dependencies, now);
    createdIds[node.sourceId] = conflict.existingBookmarkId;
    return finishNode(input, createdIds);
  }

  const parentId = node.parentSourceId
    ? createdIds[node.parentSourceId]
    : input.plan.destinationParentId;
  if (!parentId) throw new Error('missing-import-parent');
  if (recoveringInFlight) {
    const recovered = await findCreatedAfterRecovery(
      node,
      parentId,
      input,
      dependencies
    );
    if (recovered) {
      const adopted = await dependencies.commands.adoptCreated({
        bookmarkId: recovered.id,
        batchId: input.plan.id,
        idempotencyKey: `backup-import:${input.plan.id}:${node.sourceId}`
      });
      if (!adopted.ok) throw new Error(`import-command-${adopted.error.code}`);
      createdIds[node.sourceId] = recovered.id;
      await applyImportedMetadata(
        node,
        recovered.id,
        input.plan.id,
        dependencies,
        now
      );
      return finishNode(input, createdIds);
    }
  }
  const result = await dependencies.commands.create({
    parentId,
    index: node.index,
    title: node.title,
    ...(node.url ? { url: node.url } : {}),
    batchId: input.plan.id,
    idempotencyKey: `backup-import:${input.plan.id}:${node.sourceId}`
  });
  if (!result.ok) throw new Error(`import-command-${result.error.code}`);
  const bookmarkId = result.value.bookmarkId;
  createdIds[node.sourceId] = bookmarkId;
  await applyImportedMetadata(
    node,
    bookmarkId,
    input.plan.id,
    dependencies,
    now
  );
  return finishNode(input, createdIds);
}

async function findCreatedAfterRecovery(
  node: ImportNode,
  parentId: string,
  input: ImportApplicationTaskInput,
  dependencies: ImportApplicationDependencies
): Promise<BookmarkNode | null> {
  const recovery = (await dependencies.recoveryPoints.list()).find(
    (point) => point.id === input.recoveryPointId
  );
  if (!recovery) throw new Error('import-recovery-point-missing');
  const originalIds = new Set(recovery.nodes.map((item) => item.id));
  return (
    (await dependencies.bookmarks.getTree()).find(
      (candidate) =>
        !originalIds.has(candidate.id) &&
        candidate.parentId === parentId &&
        candidate.index === node.index &&
        candidate.title === node.title &&
        (candidate.url ?? '') === (node.url ?? '')
    ) ?? null
  );
}

async function applyImportedMetadata(
  node: ImportNode,
  bookmarkId: string,
  batchId: string,
  dependencies: ImportApplicationDependencies,
  now: () => number
): Promise<void> {
  if (!node.metadata) return;
  const metadataResult = await dependencies.commands.updateMetadata(
    completeMetadata(bookmarkId, node.metadata, now()),
    batchId
  );
  if (!metadataResult.ok)
    throw new Error(`import-metadata-${metadataResult.error.code}`);
}

function finishNode(
  input: ImportApplicationTaskInput,
  createdIds: Record<string, string>
): ImportApplicationTaskInput {
  const next = { ...input, createdIds, nextIndex: input.nextIndex + 1 };
  delete next.inFlightSourceId;
  return next;
}

async function mergeMetadata(
  node: ImportNode,
  bookmarkId: string,
  dependencies: ImportApplicationDependencies,
  now: () => number
): Promise<void> {
  const current = await dependencies.metadata.get(bookmarkId);
  const incoming = completeMetadata(bookmarkId, node.metadata ?? {}, now());
  const merged = {
    ...(current ?? incoming),
    tags: [...new Set([...(current?.tags ?? []), ...incoming.tags])],
    note: mergeNotes(current?.note ?? '', incoming.note),
    updatedAt: now()
  };
  const result = await dependencies.commands.updateMetadata(
    merged,
    inputBatchId(node)
  );
  if (!result.ok) throw new Error(`import-metadata-${result.error.code}`);
}

function completeMetadata(
  bookmarkId: string,
  metadata: Partial<BookmarkMetadata>,
  updatedAt: number
): BookmarkMetadata {
  return {
    bookmarkId,
    summary: metadata.summary ?? '',
    tags: metadata.tags ?? [],
    note: metadata.note ?? '',
    confidence: metadata.confidence ?? 'unknown',
    reason: metadata.reason ?? '',
    health: metadata.health ?? 'unchecked',
    updatedAt: metadata.updatedAt ?? updatedAt
  };
}

function mergeNotes(existing: string, incoming: string): string {
  if (!incoming || existing === incoming) return existing;
  return existing ? `${existing}\n\n${incoming}` : incoming;
}

function inputBatchId(node: ImportNode): string {
  return `backup-import-metadata:${node.sourceId}`;
}
