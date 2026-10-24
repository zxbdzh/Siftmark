import type { OrganizationFolderPlan } from '../ai/organization-types';
import type { OrganizationBatchProgress } from './organization-planner';

const CHECKPOINT_KEY = 'siftmark.organization.checkpoint.v1';

export interface OrganizationCheckpoint {
  version: 1;
  savedAt: number;
  profileKey: string;
  concurrency: number;
  bookmarkIds: string[];
  batches: OrganizationBatchProgress[];
  folders: OrganizationFolderPlan[];
  backupFilename?: string;
  pipelineError?: string;
}

interface CheckpointStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const checkpointWrites = new WeakMap<CheckpointStorage, Promise<void>>();

function writeCheckpoint(
  storage: CheckpointStorage,
  operation: () => Promise<void>
) {
  // 保存和清空共用一条队列，防止晚到的旧写入覆盖新检查点或在完成后复活任务。
  const next = (checkpointWrites.get(storage) ?? Promise.resolve()).then(
    operation,
    operation
  );
  checkpointWrites.set(
    storage,
    next.catch(() => {})
  );
  return next;
}

export async function loadOrganizationCheckpoint(
  storage: CheckpointStorage
): Promise<OrganizationCheckpoint | undefined> {
  await checkpointWrites.get(storage);
  const stored = await storage.get(CHECKPOINT_KEY);
  const value = stored[CHECKPOINT_KEY];
  if (!isCheckpoint(value)) return undefined;
  return value;
}

export async function saveOrganizationCheckpoint(
  storage: CheckpointStorage,
  checkpoint: OrganizationCheckpoint
): Promise<void> {
  const snapshot = structuredClone(checkpoint);
  await writeCheckpoint(storage, () =>
    storage.set({ [CHECKPOINT_KEY]: snapshot })
  );
}

export async function clearOrganizationCheckpoint(
  storage: CheckpointStorage
): Promise<void> {
  await writeCheckpoint(storage, () => storage.remove(CHECKPOINT_KEY));
}

function isCheckpoint(value: unknown): value is OrganizationCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as Partial<OrganizationCheckpoint>;
  return (
    checkpoint.version === 1 &&
    typeof checkpoint.profileKey === 'string' &&
    Array.isArray(checkpoint.bookmarkIds) &&
    Array.isArray(checkpoint.batches)
  );
}
