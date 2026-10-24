import type {
  OrganizationFolderPlan,
  OrganizationSimilarity
} from '../ai/organization-types';
import type { ModelProfile } from '../ai/types';
import {
  organizationPathKey,
  validateOrganizationPlan,
  type BookmarkOrganizationPlanner,
  type OrganizationBatchProgress,
  type OrganizationPlan
} from './organization-planner';
import type { BookmarkRepository } from './ports';
import { isBookmark, type BookmarkNode } from './types';
import {
  groupOrganizationDuplicates,
  type OrganizationDuplicateGroup
} from './organization-duplicates';

export interface OrganizationApproval {
  approved: boolean;
  keepBookmarkIds?: Record<string, string>;
}

export type OrganizeStage =
  | 'backup'
  | 'flattening'
  | 'reading'
  | 'planning'
  | 'assigning'
  | 'reviewing'
  | 'preview'
  | 'cancelled'
  | 'creating'
  | 'moving'
  | 'completed'
  | 'failed';
export const ORGANIZE_STAGE_LABELS: Record<OrganizeStage, string> = {
  backup: '完整 HTML 备份',
  flattening: '扫描可整理书签',
  reading: '分析标题与网址',
  planning: '合并分类方案',
  assigning: '确定全部归属',
  reviewing: '复核相似书签',
  preview: '等待确认分类方案',
  cancelled: '已取消，未执行改动',
  creating: '创建分类目录',
  moving: '移动到对应分类',
  completed: '整理完成',
  failed: '整理已停止'
};

export interface OrganizeItemProgress {
  bookmarkId: string;
  title: string;
  url: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  sourceFolderPath: string[];
  selectedFolderPath?: string[];
  destinationPath?: string[];
  confidence?: 'high' | 'medium' | 'low';
  reason?: string;
  summary?: string;
  action?: 'moved' | 'kept' | 'recycled';
  duplicateOf?: string;
  error?: string;
  phase?: 'classifying' | 'validating' | 'moving';
}

export interface OrganizeProgress {
  stage: OrganizeStage;
  startedAt: number;
  stageStartedAt: number;
  stoppedStage?: OrganizeStage;
  batch?: number;
  batchTotal?: number;
  batches?: OrganizationBatchProgress[];
  concurrency?: number;
  similarities?: OrganizationSimilarity[];
  duplicates?: OrganizationDuplicateGroup[];
  recycled?: number;
  recycleFailed?: number;
  newFolderPaths: string[][];
  moveCount: number;
  total: number;
  read: number;
  assigned: number;
  completed: number;
  failed: number;
  skipped: number;
  createdFolders: number;
  folders: OrganizationFolderPlan[];
  pipelineError?: string;
  currentTitle: string;
  backupFilename: string;
  items: OrganizeItemProgress[];
  errors: Array<{ title: string; message: string }>;
}

type OrganizationBookmarks = Pick<
  BookmarkRepository,
  'getTree' | 'get' | 'create' | 'move'
>;

export function organizationScope(
  nodes: BookmarkNode[],
  excludedFolderIds: string[]
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const excluded = new Set(excludedFolderIds);
  const targets = nodes
    .filter(isBookmark)
    .filter(
      (node) =>
        supportedUrl(node.url) && !inExcludedFolder(node, byId, excluded)
    );
  return { targets, skipped: nodes.filter(isBookmark).length - targets.length };
}

export async function organizeBookmarks(options: {
  bookmarks: OrganizationBookmarks;
  planner: Pick<BookmarkOrganizationPlanner, 'plan'>;
  backup: (nodes: BookmarkNode[]) => Promise<string>;
  excludedFolderIds: string[];
  report: (progress: OrganizeProgress) => void;
  confirm: (
    preview: OrganizeProgress
  ) => Promise<boolean | OrganizationApproval>;
  recycle?: (bookmark: BookmarkNode, keeper: BookmarkNode) => Promise<void>;
  checkRecycle?: () => Promise<void>;
  recordSimilarities?: (
    pairs: OrganizationSimilarity[],
    bookmarks: BookmarkNode[],
    keepers?: Record<string, string>
  ) => Promise<void>;
  adaptPlan?: (plan: OrganizationPlan) => Promise<OrganizationPlan>;
  concurrency?: number;
  resumeBatches?: OrganizationBatchProgress[];
  resumeFolders?: OrganizationFolderPlan[];
  classifyProfile: ModelProfile;
}): Promise<OrganizeProgress> {
  const nodes = await options.bookmarks.getTree();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const excluded = new Set(options.excludedFolderIds);
  const { targets, skipped } = organizationScope(
    nodes,
    options.excludedFolderIds
  );
  const { groups: duplicates, representatives } =
    groupOrganizationDuplicates(targets);
  const progress: OrganizeProgress = {
    duplicates,
    recycled: 0,
    recycleFailed: 0,
    stage: 'backup',
    startedAt: Date.now(),
    stageStartedAt: Date.now(),
    newFolderPaths: [],
    moveCount: 0,
    total: representatives.length,
    read: 0,
    assigned: 0,
    completed: 0,
    failed: 0,
    skipped,
    createdFolders: 0,
    folders: [],
    currentTitle: '',
    backupFilename: '',
    items: targets.map((node) => ({
      bookmarkId: node.id,
      title: node.title,
      url: node.url,
      status: 'pending',
      sourceFolderPath: folderPathForBookmark(node, byId)
    })),
    errors: []
  };
  let previousStage = progress.stage;
  for (const group of duplicates)
    for (const node of group.bookmarks.slice(1))
      progress.items.find((item) => item.bookmarkId === node.id)!.duplicateOf =
        group.id;
  const publish = () => {
    if (progress.stage !== previousStage) {
      progress.stageStartedAt = Date.now();
      previousStage = progress.stage;
      progress.batch = undefined;
      progress.batchTotal = undefined;
    }
    options.report({
      ...progress,
      items: progress.items.map((item) => ({ ...item })),
      errors: [...progress.errors],
      folders: [...progress.folders],
      newFolderPaths: [...progress.newFolderPaths]
    });
  };
  publish();
  try {
    // 扁平化只是逻辑快照；HTML 下载确认完成前绝不改动浏览器中的书签或目录。
    progress.backupFilename = await options.backup(nodes);
    progress.stage = 'flattening';
    publish();
    if (!targets.length) {
      progress.stage = 'completed';
      publish();
      return progress;
    }
    // 存在同 URL 副本时，确认后必须能回收；备份后先查，避免耗完模型额度才发现无法执行。
    if (duplicates.length) {
      if (!options.recycle || !options.checkRecycle)
        throw new Error('未配置回收站，未执行改动；请先在设置绑定回收站');
      await options.checkRecycle();
    }
    const flatBookmarks = representatives.map((node) => ({
      id: node.id,
      title: node.title,
      url: node.url,
      currentFolderPath: folderPathForBookmark(node, byId)
    }));
    const itemsById = new Map(
      progress.items.map((item) => [item.bookmarkId, item])
    );
    progress.stage = 'reading';
    publish();
    const plan = await options.planner.plan(
      flatBookmarks,
      options.classifyProfile,
      (update) => {
        progress.stage = update.stage;
        publish();
        progress.batches = update.batches;
        progress.concurrency = options.concurrency ?? 2;
        progress.batch = update.batch;
        progress.batchTotal = update.batchTotal;
        progress.read = update.read;
        progress.assigned = update.assigned;
        progress.folders = update.folders;
        progress.similarities = update.similarities;
        for (const assignment of update.assignments ?? []) {
          const item = itemsById.get(assignment.bookmarkId);
          if (item)
            Object.assign(item, {
              selectedFolderPath: assignment.folderPath,
              confidence: assignment.confidence,
              summary: assignment.summary,
              reason: assignment.reason
            });
        }
        publish();
      },
      {
        concurrency: options.concurrency,
        resumeBatches: options.resumeBatches,
        resumeFolders: options.resumeFolders
      }
    );
    const adaptedPlan = options.adaptPlan ? await options.adaptPlan(plan) : plan;
    Object.assign(plan, adaptedPlan);
    validateOrganizationPlan(plan, flatBookmarks);
    progress.similarities = plan.similarities ?? [];
    await options.recordSimilarities?.(progress.similarities, targets);
    progress.folders = plan.folders;
    progress.read = representatives.length;
    progress.assigned = representatives.length;
    for (const assignment of plan.assignments) {
      Object.assign(itemsById.get(assignment.bookmarkId)!, {
        selectedFolderPath: assignment.folderPath,
        confidence: assignment.confidence,
        summary: assignment.summary,
        reason: assignment.reason
      });
    }
    const preview = inspectOrganizationFolders(
      await options.bookmarks.getTree(),
      plan,
      excluded
    );
    progress.newFolderPaths = preview.newFolderPaths;
    progress.moveCount = representatives.filter((node) => {
      const path = itemsById.get(node.id)!.selectedFolderPath!;
      let parent: BookmarkNode | undefined = preview.root;
      for (const name of path)
        parent = parent ? preview.childFor(parent.id, name) : undefined;
      return parent?.id !== node.parentId;
    }).length;
    progress.stage = 'preview';
    publish();
    // 整批归属与目录冲突检查通过后仍不改动，必须由用户确认本次方案。
    const decision = await options.confirm({ ...progress });
    if (!(typeof decision === 'boolean' ? decision : decision.approved)) {
      progress.stage = 'cancelled';
      publish();
      return progress;
    }
    const selectedKeepers =
      typeof decision === 'boolean' ? {} : (decision.keepBookmarkIds ?? {});
    const executionTargets = [...representatives];
    for (const group of duplicates) {
      const keeper = group.bookmarks.find(
        (node) =>
          node.id === (selectedKeepers[group.id] ?? group.keepBookmarkId)
      );
      if (!keeper) throw new Error('保留项不属于本次重复组，未执行改动');
      const assignment = plan.assignments.find(
        (row) => row.bookmarkId === group.id
      )!;
      Object.assign(itemsById.get(keeper.id)!, {
        selectedFolderPath: assignment.folderPath,
        confidence: assignment.confidence,
        summary: assignment.summary,
        reason: assignment.reason
      });
      assignment.bookmarkId = keeper.id;
      executionTargets[
        executionTargets.findIndex((node) => node.id === group.id)
      ] = keeper;
      for (const node of group.bookmarks) {
        const item = itemsById.get(node.id)!;
        if (node.id === keeper.id) delete item.duplicateOf;
        else item.duplicateOf = keeper.id;
      }
      group.keepBookmarkId = keeper.id;
    }
    // 同 URL 改选后让相似记录指向实际保留项，避免后续审核已回收的代表项。
    await options.recordSimilarities?.(
      progress.similarities ?? [],
      targets,
      Object.fromEntries(
        duplicates.map((group) => [group.id, group.keepBookmarkId])
      )
    );
    if (duplicates.length) {
      if (!options.recycle || !options.checkRecycle)
        throw new Error('未配置回收站，未执行改动；请先在设置绑定回收站');
      await options.checkRecycle();
    }
    progress.stage = 'creating';
    publish();
    const destinations = await createOrganizationFolders(
      options.bookmarks,
      plan,
      excluded,
      progress.newFolderPaths,
      () => {
        progress.createdFolders += 1;
        publish();
      }
    );
    progress.stage = 'moving';
    publish();
    const assignments = new Map(
      plan.assignments.map((assignment) => [assignment.bookmarkId, assignment])
    );
    for (const node of executionTargets) {
      const item = itemsById.get(node.id)!;
      const destination = destinations.get(
        organizationPathKey(assignments.get(node.id)!.folderPath)
      )!;
      progress.currentTitle = node.title;
      item.status = 'running';
      item.phase = 'validating';
      publish();
      try {
        const current = await options.bookmarks.get(node.id);
        if (!current || !isBookmark(current))
          throw new Error('书签已删除，未重新创建');
        if (
          current.title !== node.title ||
          current.url !== node.url ||
          current.parentId !== node.parentId
        )
          throw new Error('书签在整理期间已变更，已保留当前状态');
        // 目录也可能被用户移动或删除，逐次检查路径身份，避免把书签移入错误位置。
        for (const folder of destination.chain) {
          const live = await options.bookmarks.get(folder.id);
          if (
            !live ||
            isBookmark(live) ||
            live.parentId !== folder.parentId ||
            live.title !== folder.title
          )
            throw new Error('目标目录在整理期间已变更，书签保留原位');
        }
        await assertSourceOutsideExcluded(
          options.bookmarks,
          current.parentId,
          excluded
        );
        if (current.parentId !== destination.node.id) {
          item.phase = 'moving';
          publish();
          await options.bookmarks.move(current.id, destination.node.id);
          item.action = 'moved';
        } else {
          item.action = 'kept';
        }
        item.destinationPath = destination.chain
          .slice(1)
          .map((folder) => folder.title);
        item.status = 'completed';
        progress.completed += 1;
      } catch (error) {
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : '移动失败';
        progress.failed += 1;
        progress.errors.push({ title: node.title, message: item.error });
      }
      publish();
    }
    for (const group of duplicates) {
      const keeper = executionTargets.find(
        (node) => node.id === group.keepBookmarkId
      )!;
      for (const original of group.bookmarks.filter(
        (node) => node.id !== keeper.id
      )) {
        const item = itemsById.get(original.id)!;
        try {
          // 保留项未成功落位时不得回收副本，避免只剩已被删除或改动的书签。
          if (itemsById.get(keeper.id)!.status !== 'completed')
            throw new Error('保留项未完成整理，本组副本保持原位');
          const currentKeeper = await options.bookmarks.get(keeper.id);
          const current = await options.bookmarks.get(original.id);
          if (
            !currentKeeper ||
            currentKeeper.url !== group.url ||
            !current ||
            current.url !== group.url ||
            current.title !== original.title ||
            current.parentId !== original.parentId
          )
            throw new Error('重复组在整理期间已变更，副本保持原位');
          await assertSourceOutsideExcluded(
            options.bookmarks,
            current.parentId,
            excluded
          );
          await options.recycle!(current, currentKeeper);
          item.status = 'completed';
          item.action = 'recycled';
          progress.recycled! += 1;
        } catch (error) {
          item.status = 'failed';
          item.error =
            error instanceof Error ? error.message : '重复项回收失败';
          progress.recycleFailed! += 1;
          progress.errors.push({ title: original.title, message: item.error });
        }
        publish();
      }
    }
    progress.currentTitle = '';
    progress.stage = 'completed';
    publish();
    return progress;
  } catch (error) {
    progress.stoppedStage = progress.stage;
    progress.stage = 'failed';
    progress.pipelineError =
      error instanceof Error ? error.message : '全量规划失败';
    publish();
    throw error;
  }
}

interface OrganizationDestination {
  node: BookmarkNode;
  chain: BookmarkNode[];
}

function inspectOrganizationFolders(
  nodes: BookmarkNode[],
  plan: OrganizationPlan,
  excluded: Set<string>
) {
  const root =
    nodes.find(
      (node) =>
        node.parentId === '0' &&
        !isBookmark(node) &&
        /书签栏|收藏夹栏|bookmarks bar|favorites bar/i.test(node.title)
    ) ?? nodes.find((node) => node.parentId === '0' && !isBookmark(node));
  if (!root) throw new Error('未找到浏览器书签栏');
  if (excluded.has(root.id))
    throw new Error('书签栏已被设为受保护目录，未执行移动');
  const paths = new Map(
    plan.assignments.map((assignment) => [
      organizationPathKey(assignment.folderPath),
      assignment.folderPath
    ])
  );
  const childFor = (parentId: string, name: string) => {
    const matches = nodes.filter(
      (node) =>
        !isBookmark(node) &&
        node.parentId === parentId &&
        organizationPathKey([node.title]) === organizationPathKey([name])
    );
    if (matches.length > 1)
      throw new Error(`存在多个同名目录“${name}”，未执行移动`);
    if (matches[0] && excluded.has(matches[0].id))
      throw new Error(`规划目录“${name}”与受保护目录冲突，未执行移动`);
    return matches[0];
  };
  // 预览与执行共用目录检查，所有冲突必须在第一次创建之前发现。
  const missing = new Map<string, string[]>();
  for (const path of paths.values()) {
    let parent: BookmarkNode | undefined = root;
    for (const [index, name] of path.entries()) {
      parent = parent ? childFor(parent.id, name) : undefined;
      if (!parent) {
        const prefix = path.slice(0, index + 1);
        missing.set(organizationPathKey(prefix), prefix);
      }
    }
  }
  return {
    nodes,
    root,
    paths,
    childFor,
    newFolderPaths: [...missing.values()]
  };
}

async function createOrganizationFolders(
  bookmarks: OrganizationBookmarks,
  plan: OrganizationPlan,
  excluded: Set<string>,
  approvedNewPaths: string[][],
  created: () => void
): Promise<Map<string, OrganizationDestination>> {
  const { nodes, root, paths, childFor, newFolderPaths } =
    inspectOrganizationFolders(await bookmarks.getTree(), plan, excluded);
  const approved = new Set(approvedNewPaths.map(organizationPathKey));
  if (newFolderPaths.some((path) => !approved.has(organizationPathKey(path))))
    throw new Error('目录结构在确认期间已变更，请重新生成方案；未执行改动');
  const destinations = new Map<string, OrganizationDestination>();
  for (const [key, path] of paths) {
    let parent = root;
    const chain = [root];
    for (const name of path) {
      let child = childFor(parent.id, name);
      if (!child) {
        child = await bookmarks.create({
          parentId: parent.id,
          title: name,
          index: nodes.filter((node) => node.parentId === parent.id).length
        });
        nodes.push(child);
        created();
      }
      parent = child;
      chain.push(child);
    }
    destinations.set(key, { node: parent, chain });
  }
  return destinations;
}

async function assertSourceOutsideExcluded(
  bookmarks: OrganizationBookmarks,
  parentId: string,
  excluded: Set<string>
) {
  const visited = new Set<string>();
  while (parentId && parentId !== '0') {
    if (excluded.has(parentId))
      throw new Error('书签已进入归档区或回收站，保留原位');
    if (visited.has(parentId)) throw new Error('源目录结构异常，保留原位');
    visited.add(parentId);
    const parent = await bookmarks.get(parentId);
    if (!parent || isBookmark(parent))
      throw new Error('源目录已变更，保留原位');
    parentId = parent.parentId;
  }
}

function inExcludedFolder(
  node: BookmarkNode,
  byId: Map<string, BookmarkNode>,
  excluded: Set<string>
): boolean {
  const visited = new Set<string>();
  let current: BookmarkNode | undefined = node;
  while (current && !visited.has(current.id)) {
    if (excluded.has(current.id)) return true;
    visited.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
}

function folderPathForBookmark(
  node: BookmarkNode,
  byId: Map<string, BookmarkNode>
): string[] {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(node.parentId);
  while (current && current.parentId !== '0' && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.title) parts.unshift(current.title);
    current = byId.get(current.parentId);
  }
  return parts;
}

function supportedUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
