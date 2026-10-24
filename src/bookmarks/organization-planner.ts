import type { AiAdapterRegistry } from '../ai/adapter-registry';
import type {
  AiOrganizationContext,
  AiOrganizationResult,
  OrganizationAssignment,
  OrganizationBookmarkInput,
  OrganizationSimilarity,
  OrganizationFolderPlan
} from '../ai/organization-types';
import { organizationBookmarkData } from '../ai/prompts/organization-prompt';
import { ORGANIZATION_LIMITS } from '../ai/schemas/organization-contract';
import { organizationResultSchema } from '../ai/schemas/organization-parser';
import { sha256Hex } from '../backup/checksum';
import type { ModelProfile } from '../ai/types';
import {
  similarityCandidates,
  similarityKey,
  similarityReviewBatches,
  validateSimilarities
} from './organization-similarity';

export interface OrganizationPlan {
  folders: OrganizationFolderPlan[];
  assignments: OrganizationAssignment[];
  similarities?: OrganizationSimilarity[];
}

export interface OrganizationBatchProgress {
  id: string;
  stage: 'reading' | 'planning' | 'assigning' | 'reviewing';
  batch: number;
  count: number;
  status:
    'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';
  attempt: number;
  startedAt?: number;
  finishedAt?: number;
  retryAfterMs?: number;
  summary?: string;
  folders?: OrganizationFolderPlan[];
  assignments?: OrganizationAssignment[];
  similarities?: OrganizationSimilarity[];
  ignoredSimilarities?: number; // 建议与有效归属分开计数，不把不可靠配对写入审核记录。
  requestKey?: string; // 只保存输入摘要，恢复时核对书签内容、模型和固定目录树。
  error?: string;
}

export interface OrganizationPlanningProgress {
  stage: 'reading' | 'planning' | 'assigning' | 'reviewing';
  read: number;
  assigned: number;
  folders: OrganizationFolderPlan[];
  batch?: number;
  batchTotal?: number;
  batches?: OrganizationBatchProgress[];
  assignments?: OrganizationAssignment[];
  similarities?: OrganizationSimilarity[];
}

export function organizationConcurrency(value = 2) {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(4, Math.trunc(value)))
    : 2;
}

export class BookmarkOrganizationPlanner {
  constructor(private readonly adapters: AiAdapterRegistry) {}

  async plan(
    bookmarks: OrganizationBookmarkInput[],
    profile: ModelProfile,
    report: (update: OrganizationPlanningProgress) => void,
    options: {
      concurrency?: number;
      resumeBatches?: OrganizationBatchProgress[];
      resumeFolders?: OrganizationFolderPlan[];
    } = {}
  ): Promise<OrganizationPlan> {
    if (
      profile.state !== 'verified' ||
      !profile.capabilities.includes('classify')
    )
      throw new Error('本次整理选择的分类模型不可用');
    const adapter = this.adapters.get(profile.protocol);
    if (!adapter?.planOrganization)
      throw new Error('所选协议不支持全量目录规划');
    // 超时和并发只影响本次任务，不写回模型档案或全局默认。
    const requestProfile = {
      ...profile,
      timeoutMs: Math.max(
        profile.timeoutMs,
        ORGANIZATION_LIMITS.minRequestTimeoutMs
      )
    };
    const mergeProfile = {
      ...requestProfile,
      timeoutMs: Math.max(
        requestProfile.timeoutMs,
        ORGANIZATION_LIMITS.minMergeTimeoutMs
      )
    };
    const controller = new AbortController();
    const concurrency = organizationConcurrency(options.concurrency);
    const batches = splitOrganizationBookmarks(bookmarks);
    const requests: OrganizationBatchProgress[] = [];
    let folders: OrganizationFolderPlan[] = [];
    let read = 0;
    const assignments: OrganizationAssignment[] = [];
    const similarities = new Map<string, OrganizationSimilarity>();
    let stage: OrganizationPlanningProgress['stage'] = 'reading';
    const publish = (
      batch?: number,
      updateAssignments?: OrganizationAssignment[]
    ) =>
      report({
        stage,
        read,
        assigned: assignments.length,
        folders: [...folders],
        similarities: [...similarities.values()],
        batch,
        batchTotal: requests.filter((request) => request.stage === stage)
          .length,
        batches: requests.map((request) => ({ ...request })),
        assignments: updateAssignments
      });
    const saved = options.resumeBatches ?? [];
    const requestBatch = async <T>(
      context: AiOrganizationContext,
      item: OrganizationBatchProgress,
      accept: (result: AiOrganizationResult) => T
    ): Promise<T> => {
      item.requestKey = await sha256Hex(
        new TextEncoder().encode(
          JSON.stringify({
            mode: context.mode,
            profile: [
              profile.id,
              profile.version,
              profile.protocol,
              profile.endpoint,
              profile.model,
              profile.structuredOutput ?? 'json_schema'
            ],
            bookmarks: context.bookmarks.map(({ id, title, url }) => ({
              id,
              title,
              url
            })),
            suggestedFolders: context.suggestedFolders,
            taxonomy: context.taxonomy,
            candidatePairs: context.candidatePairs
          })
        )
      );
      const previous = saved.find(
        (row) => row.id === item.id && row.stage === item.stage
      );
      // 旧版通读检查点没有摘要，仍可沿用主题；新检查点必须逐批核对输入。
      const legacyReading =
        context.mode === 'taxonomy' &&
        !previous?.requestKey &&
        previous?.count === item.count;
      if (
        previous?.status === 'completed' &&
        (previous.requestKey === item.requestKey || legacyReading)
      ) {
        try {
          const cached = {
            folders: previous.folders ?? [],
            assignments: previous.assignments ?? [],
            similarities: previous.similarities ?? []
          };
          // 缓存只存合格建议；恢复时仍保留之前忽略数量，避免警告在重新打开后消失。
          item.ignoredSimilarities = previous.ignoredSimilarities;
          const value = accept(cached);
          Object.assign(item, {
            status: 'completed',
            attempt: previous.attempt,
            startedAt: previous.startedAt,
            finishedAt: previous.finishedAt
          });
          publish(
            item.batch,
            context.mode === 'assign' ? cached.assignments : undefined
          );
          return value;
        } catch {
          // 本机缓存也要经过与模型响应相同的校验，不合格时仅重新请求该批。
          item.folders = undefined;
          item.assignments = undefined;
          item.similarities = undefined;
          item.ignoredSimilarities = undefined;
        }
      }
      item.startedAt = Date.now();
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        // 单批偶发不合规不取消其余已成功批次；连续 3 次仍失败才停整批。
        item.attempt = attempt;
        item.status = 'running';
        item.retryAfterMs = undefined;
        publish(item.batch);
        try {
          const result = await adapter.planOrganization!(
            context.mode === 'merge-taxonomy' ? mergeProfile : requestProfile,
            {
              ...context,
              onRequestState: (state) => {
                if (controller.signal.aborted) return;
                Object.assign(item, state, {
                  attempt: attempt + (state.attempt ?? 1) - 1
                });
                publish(item.batch);
              }
            },
            controller.signal
          );
          controller.signal.throwIfAborted();
          const value = accept(result);
          item.status = 'completed';
          item.finishedAt = Date.now();
          publish(
            item.batch,
            context.mode === 'assign' ? result.assignments : undefined
          );
          return value;
        } catch (error) {
          const retry =
            attempt < 3 &&
            !controller.signal.aborted &&
            isRetryableStructureError(error);
          if (!retry) {
            item.status = controller.signal.aborted ? 'cancelled' : 'failed';
            item.error = error instanceof Error ? error.message : '批次失败';
            item.finishedAt = Date.now();
            publish(item.batch);
            throw error;
          }
          item.status = 'retrying';
          item.retryAfterMs = 1_000;
          publish(item.batch);
          await waitForOrganizationRetry(controller.signal);
        }
      }
      throw new Error('整理批次未完成');
    };
    const batchRows = (
      phase: OrganizationPlanningProgress['stage'],
      counts: number[]
    ) => {
      const offset = requests.filter((row) => row.stage === phase).length;
      return counts.map((count, index) => {
        const item: OrganizationBatchProgress = {
          id: `${phase}-${offset + index + 1}`,
          stage: phase,
          batch: offset + index + 1,
          count,
          status: 'queued',
          attempt: 1
        };
        requests.push(item);
        return item;
      });
    };
    const readingRows = batchRows(
      'reading',
      batches.map((batch) => batch.length)
    );
    publish();
    try {
      const savedReading = saved.filter((row) => row.stage === 'reading');
      const readingReady =
        savedReading.length === batches.length &&
        savedReading.every(
          (row) => row.status === 'completed' && !row.folders && !row.requestKey
        ) &&
        Boolean(options.resumeFolders?.length);
      let discoveredBatches: OrganizationFolderPlan[][];
      if (readingReady) {
        readingRows.forEach((row, index) => {
          const previous = savedReading[index]!;
          row.status = 'completed';
          row.summary = previous.summary ?? '沿用上次通读结果';
          row.attempt = previous.attempt;
          row.startedAt = previous.startedAt;
          row.finishedAt = previous.finishedAt;
        });
        read = bookmarks.length;
        publish();
        discoveredBatches = [options.resumeFolders!];
      } else {
        discoveredBatches = await runOrganizationPool(
          batches,
          concurrency,
          controller,
          (batch, index) => {
            return requestBatch(
              { mode: 'taxonomy', bookmarks: batch },
              readingRows[index]!,
              (result) => {
                const discovered = readTaxonomy(result);
                readingRows[index]!.folders = discovered;
                folders = [
                  ...new Map(
                    [...folders, ...discovered].map((folder) => [
                      organizationPathKey(folder.path),
                      folder
                    ])
                  ).values()
                ];
                read += batch.length;
                readingRows[index]!.summary = discovered
                  .slice(0, 3)
                  .map((folder) => folder.path.join(' / '))
                  .join('；');
                return discovered;
              }
            );
          }
        );
      }
      folders = [
        ...new Map(
          discoveredBatches
            .flat()
            .map((folder) => [organizationPathKey(folder.path), folder])
        ).values()
      ];
      stage = 'planning';
      // 目录总数不超过 80 就可以归属。模型不再减少时收起最深一层，避免反复合并后整批失败。
      while (folders.length > ORGANIZATION_LIMITS.foldersPerPlan) {
        const before = folders.length;
        const groups: OrganizationFolderPlan[][] = [];
        for (let index = 0; index < folders.length; index += 24)
          groups.push(folders.slice(index, index + 24));
        const mergeRows = batchRows(
          'planning',
          groups.map(() => 0)
        );
        const mergedBatches = await runOrganizationPool(
          groups,
          concurrency,
          controller,
          (group, index) => {
            return requestBatch(
              {
                mode: 'merge-taxonomy',
                bookmarks: [],
                suggestedFolders: group
              },
              mergeRows[index]!,
              (result) => {
                const merged = readTaxonomy(result);
                mergeRows[index]!.folders = merged;
                mergeRows[index]!.summary =
                  `合并为 ${merged.length} 个分类路径`;
                return merged;
              }
            );
          }
        );
        const reduced = dedupeFolders(mergedBatches.flat());
        if (reduced.length < before) folders = reduced;
        else {
          folders = collapseOrganizationFolders(
            folders,
            ORGANIZATION_LIMITS.foldersPerPlan
          );
          break;
        }
      }
      // 各批只提出局部主题，最后仍要合并全量候选，不能因少于 80 个路径跳过统一规划。
      const mergeRow = batchRows('planning', [0])[0]!;
      folders = await requestBatch(
        {
          mode: 'merge-taxonomy',
          bookmarks: [],
          suggestedFolders: folders
        },
        mergeRow,
        (result) => {
          const merged = readTaxonomy(result);
          mergeRow.folders = merged;
          mergeRow.summary = `合并为 ${merged.length} 个分类路径`;
          return merged;
        }
      );
      stage = 'assigning';
      const assigningRows = batchRows(
        'assigning',
        batches.map((batch) => batch.length)
      );
      publish();
      const assignedBatches = await runOrganizationPool(
        batches,
        concurrency,
        controller,
        (batch, index) => {
          return requestBatch(
            { mode: 'assign', bookmarks: batch, taxonomy: folders },
            assigningRows[index]!,
            (result) => {
              const parsed = organizationResultSchema.parse({
                folders: result.folders,
                assignments: result.assignments
              });
              if (parsed.folders.length)
                throw new Error('归属阶段不得修改全局目录树');
              validateOrganizationPlan(
                { folders, assignments: parsed.assignments },
                batch
              );
              const row = assigningRows[index]!;
              const pairs = validateSimilarities(
                result.similarities ?? [],
                batch,
                undefined,
                (count) => {
                  row.ignoredSimilarities = Math.max(
                    row.ignoredSimilarities ?? 0,
                    count
                  );
                }
              );
              for (const pair of pairs)
                similarities.set(similarityKey(pair.bookmarkIds), pair);
              assignments.push(...parsed.assignments);
              row.assignments = parsed.assignments;
              row.similarities = pairs;
              row.summary =
                `已校验 ${parsed.assignments.length} 条归属` +
                (row.ignoredSimilarities
                  ? `；忽略 ${row.ignoredSimilarities} 条不合格相似建议`
                  : '');
              return parsed.assignments;
            }
          );
        }
      );
      const candidates = similarityCandidates(bookmarks).filter(
        (pair) => !similarities.has(similarityKey(pair))
      );
      const reviews = similarityReviewBatches(candidates, bookmarks);
      if (reviews.length) {
        stage = 'reviewing';
        const rows = batchRows(
          stage,
          reviews.map((batch) => batch.bookmarks.length)
        );
        publish();
        await runOrganizationPool(
          reviews,
          concurrency,
          controller,
          (batch, index) =>
            requestBatch(
              {
                mode: 'review-similarity',
                bookmarks: batch.bookmarks,
                candidatePairs: batch.pairs
              },
              rows[index]!,
              (result) => {
                if (result.folders.length || result.assignments.length)
                  throw new Error('相似复核不得修改目录或归属');
                const pairs = validateSimilarities(
                  result.similarities,
                  batch.bookmarks,
                  batch.pairs,
                  (count) => {
                    rows[index]!.ignoredSimilarities = Math.max(
                      rows[index]!.ignoredSimilarities ?? 0,
                      count
                    );
                  }
                );
                rows[index]!.similarities = pairs;
                for (const pair of pairs)
                  similarities.set(similarityKey(pair.bookmarkIds), pair);
                rows[index]!.summary =
                  `发现 ${pairs.length} 对待审核相似项，默认全部保留` +
                  (rows[index]!.ignoredSimilarities
                    ? `；忽略 ${rows[index]!.ignoredSimilarities} 条不合格相似建议`
                    : '');
              }
            )
        );
      }
      const plan = {
        folders,
        assignments: assignedBatches.flat(),
        similarities: [...similarities.values()]
      };
      validateOrganizationPlan(plan, bookmarks);
      return plan;
    } catch (error) {
      controller.abort();
      for (const request of requests)
        if (['queued', 'running', 'retrying'].includes(request.status)) {
          request.status = 'cancelled';
          request.finishedAt = Date.now();
        }
      publish();
      throw error;
    }
  }
}

async function runOrganizationPool<T, R>(
  items: T[],
  concurrency: number,
  controller: AbortController,
  run: (item: T, index: number) => Promise<R> | R
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await run(items[index]!, index);
      } catch (error) {
        // 先保存第一项真实失败，再取消其他请求，避免取消错误遮盖根因。
        if (!failed) {
          failed = true;
          failure = error;
          controller.abort();
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  if (failed) throw failure;
  return results;
}

export function splitOrganizationBookmarks(
  bookmarks: OrganizationBookmarkInput[]
) {
  const batches: OrganizationBookmarkInput[][] = [];
  let batch: OrganizationBookmarkInput[] = [];
  let bytes = 0;
  for (const bookmark of bookmarks) {
    const size = new TextEncoder().encode(
      JSON.stringify(organizationBookmarkData([bookmark]))
    ).length;
    if (
      batch.length &&
      (batch.length >= ORGANIZATION_LIMITS.bookmarksPerRequest ||
        bytes + size > ORGANIZATION_LIMITS.requestDataBytes)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(bookmark);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function dedupeFolders(
  folders: OrganizationFolderPlan[]
): OrganizationFolderPlan[] {
  return [
    ...new Map(
      folders.map((folder) => [organizationPathKey(folder.path), folder])
    ).values()
  ];
}

function collapseOrganizationFolders(
  folders: OrganizationFolderPlan[],
  limit: number
): OrganizationFolderPlan[] {
  let current = dedupeFolders(folders);
  while (current.length > limit) {
    const depth = Math.max(...current.map((folder) => folder.path.length));
    // 一级目录不能再收起；超过上限时保留前若干项，保证合并一定结束。
    if (depth <= 1) return current.slice(0, limit);
    current = dedupeFolders(
      current.map((folder) =>
        folder.path.length === depth
          ? { ...folder, path: folder.path.slice(0, -1) }
          : folder
      )
    );
  }
  return current;
}

function readTaxonomy(result: AiOrganizationResult): OrganizationFolderPlan[] {
  const parsed = organizationResultSchema.parse({
    folders: result.folders,
    assignments: result.assignments
  });
  if (parsed.assignments.length)
    throw new Error('通读与目录规划阶段不得提前分配书签');
  if (!parsed.folders.length)
    throw new Error('AI 未规划任何分类目录，未执行移动');
  validateFolderPaths(parsed.folders);
  return parsed.folders;
}

export function organizationPathKey(path: string[]): string {
  return JSON.stringify(
    path.map((name) => name.normalize('NFKC').trim().toLocaleLowerCase())
  );
}

function validateFolderPaths(folders: OrganizationFolderPlan[]) {
  const seen = new Set<string>();
  const namesByParent = new Map<string, string>();
  for (const folder of folders) {
    const key = organizationPathKey(folder.path);
    if (seen.has(key)) throw new Error('AI 规划了重复目录，未执行移动');
    seen.add(key);
    for (let depth = 1; depth <= folder.path.length; depth += 1) {
      const prefix = folder.path.slice(0, depth);
      const prefixKey = organizationPathKey(prefix);
      const spelling = JSON.stringify(prefix);
      if (
        namesByParent.has(prefixKey) &&
        namesByParent.get(prefixKey) !== spelling
      )
        throw new Error('AI 目录命名存在大小写或字符冲突，未执行移动');
      namesByParent.set(prefixKey, spelling);
    }
  }
}

export function validateOrganizationPlan(
  plan: OrganizationPlan,
  bookmarks: OrganizationBookmarkInput[]
): void {
  const { folders } = organizationResultSchema.parse({
    folders: plan.folders,
    assignments: []
  });
  validateFolderPaths(folders);
  const paths = new Set(folders.map((folder) => JSON.stringify(folder.path)));
  const expected = new Set(bookmarks.map((bookmark) => bookmark.id));
  const seen = new Set<string>();
  // 全量覆盖校验放在任何目录创建和移动之前，模型遗漏或重复 ID 时整批保持原位。
  for (
    let offset = 0;
    offset < plan.assignments.length;
    offset += ORGANIZATION_LIMITS.bookmarksPerRequest
  ) {
    const { assignments } = organizationResultSchema.parse({
      folders: [],
      assignments: plan.assignments.slice(
        offset,
        offset + ORGANIZATION_LIMITS.bookmarksPerRequest
      )
    });
    for (const assignment of assignments) {
      if (
        !expected.has(assignment.bookmarkId) ||
        seen.has(assignment.bookmarkId)
      )
        throw new Error('AI 书签归属包含未知或重复 ID，未执行移动');
      if (!paths.has(JSON.stringify(assignment.folderPath)))
        throw new Error('AI 选择了全局规划之外的目录，未执行移动');
      seen.add(assignment.bookmarkId);
    }
  }
  if (seen.size !== expected.size)
    throw new Error('AI 未为全部书签分配目录，未执行移动');
}

function isRetryableStructureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return (
    message.includes('不符合目录和归属结构') ||
    message.includes('不是有效 JSON')
  );
}

function waitForOrganizationRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, 1_000);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      if (signal.aborted) reject(signal.reason ?? new Error('已取消'));
      else resolve();
    }
  });
}
