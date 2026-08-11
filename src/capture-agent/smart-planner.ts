import type { AiAdapterRegistry } from '../ai/adapter-registry';
import type { ProfileRepository } from '../ai/profiles/profile-repository';
import { selectProfileForCapability } from '../ai/profiles/profile-selector';
import { redactSensitiveText } from '../ai/security/redact-sensitive';
import type { AiRequestContext } from '../ai/types';
import type { BookmarkRepository } from '../bookmarks/ports';
import { isBookmark, type BookmarkNode } from '../bookmarks/types';
import { normalizeUrlConservatively } from '../health/url-normalization';
import { RuleEngine } from '../rules/rule-engine';
import type { ChromeSettingsRepository } from '../settings/settings-repository';
import type { MetadataRepository } from '../storage/types';
import type {
  CapturePlanner,
  CapturePlannerInput,
  CaptureRevisionInput
} from './capture-agent';
import type {
  CaptureFolderRef,
  CapturePlan,
  CapturePreference,
  CaptureRelatedBookmark
} from './types';

const MAX_FOLDER_CANDIDATES = 24;
const MAX_RELATED_BOOKMARKS = 5;

export interface SmartCapturePlannerDependencies {
  bookmarks: Pick<BookmarkRepository, 'getTree'>;
  profiles: Pick<ProfileRepository, 'list'>;
  settings: Pick<
    ChromeSettingsRepository,
    | 'getProfileAssignments'
    | 'getSmartBookmarkSettings'
    | 'getPromptRules'
    | 'getRules'
  >;
  adapters: AiAdapterRegistry;
  metadata?: Pick<MetadataRepository, 'get'>;
  now?: () => number;
}

export class SmartCapturePlanner implements CapturePlanner {
  private readonly now: () => number;

  constructor(private readonly dependencies: SmartCapturePlannerDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  plan(input: CapturePlannerInput): Promise<CapturePlan> {
    return this.generate(input);
  }

  revise(input: CaptureRevisionInput): Promise<CapturePlan> {
    return this.generate(input, {
      instruction: input.message,
      conversation: input.session.messages,
      currentPlan: input.session.plan,
      explicitUserCreation: true
    });
  }

  private async generate(
    input: CapturePlannerInput,
    revision?: {
      instruction: string;
      conversation: CaptureRevisionInput['session']['messages'];
      currentPlan?: CapturePlan;
      explicitUserCreation: boolean;
    }
  ): Promise<CapturePlan> {
    const [nodes, profiles, assignments, settings, promptRules, rules] =
      await Promise.all([
        this.dependencies.bookmarks.getTree(),
        this.dependencies.profiles.list(),
        this.dependencies.settings.getProfileAssignments(),
        this.dependencies.settings.getSmartBookmarkSettings(),
        this.dependencies.settings.getPromptRules(),
        this.dependencies.settings.getRules()
      ]);
    const profile = selectProfileForCapability(
      profiles,
      'classify',
      assignments.agent ?? assignments.classify
    );
    if (!profile) throw new Error('请先配置并启用分类模型');
    const adapter = this.dependencies.adapters.get(profile.protocol);
    if (!adapter) throw new Error('所选模型协议不可用');

    const catalog = buildFolderCatalog(nodes);
    const related = findRelated(input.source, nodes).slice(
      0,
      MAX_RELATED_BOOKMARKS
    );
    const relatedContext = await Promise.all(
      related.map(async (bookmark) => ({
        title: bookmark.title,
        url: stripPrivateUrlParts(bookmark.url),
        ...(this.dependencies.metadata
          ? {
              summary:
                (await this.dependencies.metadata.get(bookmark.id))?.summary ??
                ''
            }
          : {})
      }))
    );
    const maxNewFolderLevels = settings.allowNewFolders
      ? settings.maxNewFolderLevels
      : 0;
    const availableFolderPaths = rankFolderCandidates(
      catalog,
      input,
      nodes,
      settings.preferredFolderDepth
    ).map((entry) => entry.logicalPath.join('/'));
    const currentFolderPath = logicalPathForFolder(
      input.source.parentId,
      nodes
    );
    const context: AiRequestContext = {
      title: input.source.title,
      url: stripPrivateUrlParts(input.source.url),
      currentFolderPath,
      description: redactSensitiveText(input.page?.description ?? ''),
      pageText: redactSensitiveText(input.page?.text ?? ''),
      additionalRules: buildAgentRules(
        promptRules,
        input.preferences,
        revision
      ),
      availableFolderPaths,
      relatedBookmarks: relatedContext,
      folderCreationPolicy: settings.allowNewFolders
        ? settings.folderCreationLevel
        : 'off',
      maxNewFolderLevels,
      preferredFolderDepth: settings.preferredFolderDepth,
      maxTitleLength: settings.renameMaxLength,
      taskType: 'classify'
    };
    const analysis = await adapter.analyze(
      profile,
      context,
      new AbortController().signal
    );
    const resolvedDestination = resolveDestination(
      analysis.folderPath,
      catalog,
      revision?.explicitUserCreation === true,
      maxNewFolderLevels,
      input.source.parentId
    );
    const destination = resolvedDestination.destination;
    const evaluation = new RuleEngine(rules).evaluate({
      url: input.source.url,
      title: input.source.title,
      sourceFolderId: input.source.parentId
    });
    const fixedPreference = input.preferences.find(
      (preference) =>
        preference.kind === 'fixed-rule' &&
        preference.action === 'prefer-folder' &&
        preference.destinationFolderId
    );
    const terminalFolderId =
      evaluation.terminalAction?.type === 'move'
        ? evaluation.terminalAction.folderId
        : fixedPreference?.destinationFolderId;
    const relatedBookmarks: CaptureRelatedBookmark[] = related.map(
      (bookmark) => ({
        id: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        relation: bookmark.relation
      })
    );

    return {
      destination,
      title: settings.smartRename
        ? clampTitle(analysis.title, settings.renameMaxLength, input.source.title)
        : input.source.title,
      tags: analysis.tags,
      summary: analysis.summary,
      confidence: analysis.confidence,
      reason: resolvedDestination.wasTruncated
        ? `${analysis.reason}；已按设置限制新建层级`
        : analysis.reason,
      relatedBookmarks,
      generatedAt: this.now(),
      riskHints: {
        ruleConflict: Boolean(
          terminalFolderId && terminalFolderId !== destination.folderId
        ),
        pageInformation:
          input.page?.description?.trim() || input.page?.text?.trim()
            ? 'sufficient'
            : 'insufficient'
      }
    };
  }
}

interface FolderCatalogEntry {
  node: BookmarkNode;
  path: CaptureFolderRef[];
  logicalPath: string[];
}

interface RelatedNode extends BookmarkNode {
  url: string;
  relation: 'exact' | 'similar';
  score: number;
}

function buildFolderCatalog(nodes: BookmarkNode[]): FolderCatalogEntry[] {
  return nodes
    .filter((node) => !isBookmark(node) && node.id !== '0')
    .map((node) => ({
      node,
      path: pathRefsForFolder(node.id, nodes),
      logicalPath: logicalPathForFolder(node.id, nodes)
    }));
}

function rankFolderCandidates(
  catalog: FolderCatalogEntry[],
  input: CapturePlannerInput,
  nodes: BookmarkNode[],
  preferredFolderDepth: number
): FolderCatalogEntry[] {
  const preferencePaths = new Set(
    input.preferences.map((preference) => normalizePath(preference.destinationPath))
  );
  const currentPath = normalizePath(
    logicalPathForFolder(input.source.parentId, nodes)
  );
  const terms = tokenize(
    `${input.source.title} ${input.page?.description ?? ''} ${domainOf(input.source.url)}`
  );
  return [...catalog]
    .filter((entry) => entry.logicalPath.length > 0)
    .map((entry) => {
      const normalized = normalizePath(entry.logicalPath);
      const title = entry.logicalPath.join(' ').toLocaleLowerCase();
      const tokenScore = [...terms].filter((term) => title.includes(term)).length;
      const depthDistance = Math.abs(
        entry.logicalPath.length - preferredFolderDepth
      );
      const score =
        (preferencePaths.has(normalized) ? 100 : 0) +
        (normalized === currentPath ? 20 : 0) +
        tokenScore * 4 -
        depthDistance * 0.25;
      return { entry, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.logicalPath.join('/').localeCompare(
          right.entry.logicalPath.join('/'),
          'zh-CN'
        )
    )
    .slice(0, MAX_FOLDER_CANDIDATES)
    .map(({ entry }) => entry);
}

function resolveDestination(
  requestedPath: string[],
  catalog: FolderCatalogEntry[],
  explicitUserCreation: boolean,
  maxNewFolderLevels: number,
  currentFolderId: string
): {
  destination: {
    folderId: string;
    path: CaptureFolderRef[];
    newFolders: string[];
    creationSource: 'automatic' | 'explicit-user';
    maxNewFolderLevels: number;
  };
  wasTruncated: boolean;
} {
  const requested = requestedPath.map((segment) => segment.trim()).filter(Boolean);
  const creationSource = explicitUserCreation
    ? ('explicit-user' as const)
    : ('automatic' as const);
  const exact = catalog.find(
    (entry) => normalizePath(entry.logicalPath) === normalizePath(requested)
  );
  if (exact)
    return {
      destination: {
        folderId: exact.node.id,
        path: exact.path,
        newFolders: [],
        creationSource,
        maxNewFolderLevels
      },
      wasTruncated: false
    };
  let base = [...catalog]
    .filter((entry) =>
      isPathPrefix(entry.logicalPath, requested)
    )
    .sort((left, right) => right.logicalPath.length - left.logicalPath.length)[0];
  if (maxNewFolderLevels === 0 && (!base || base.logicalPath.length === 0))
    base = catalog.find((entry) => entry.node.id === currentFolderId) ?? base;
  const missingFolders = base
    ? requested.slice(base.logicalPath.length)
    : requested;
  const newFolders = missingFolders.slice(0, maxNewFolderLevels);
  if (!base)
    return {
      destination: {
        folderId: '',
        path: [],
        newFolders,
        creationSource,
        maxNewFolderLevels
      },
      wasTruncated: newFolders.length < missingFolders.length
    };
  return {
    destination: {
      folderId: base.node.id,
      path: base.path,
      newFolders,
      creationSource,
      maxNewFolderLevels
    },
    wasTruncated: newFolders.length < missingFolders.length
  };
}

function findRelated(
  source: BookmarkNode & { url: string },
  nodes: BookmarkNode[]
): RelatedNode[] {
  const normalizedUrl = normalizeUrlConservatively(source.url);
  const sourceTitle = normalizedTitle(source.title);
  const sourceDomain = domainOf(source.url);
  const related: RelatedNode[] = [];
  for (const node of nodes) {
    if (node.id === source.id || !isBookmark(node)) continue;
    if (normalizeUrlConservatively(node.url) === normalizedUrl) {
      related.push({ ...node, relation: 'exact', score: 2 });
      continue;
    }
    const titleScore = titleSimilarity(
      sourceTitle,
      normalizedTitle(node.title)
    );
    if (
      sourceDomain &&
      sourceDomain === domainOf(node.url) &&
      titleScore >= 0.5
    )
      related.push({ ...node, relation: 'similar', score: titleScore });
  }
  return related.sort(
      (left, right) =>
        Number(right.relation === 'exact') - Number(left.relation === 'exact') ||
        right.score - left.score ||
        left.id.localeCompare(right.id)
    );
}

function pathRefsForFolder(
  id: string,
  nodes: BookmarkNode[]
): CaptureFolderRef[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: CaptureFolderRef[] = [];
  let current = byId.get(id);
  while (current && current.id !== '0') {
    result.unshift({ id: current.id, title: current.title });
    current = byId.get(current.parentId);
  }
  return result;
}

function logicalPathForFolder(id: string, nodes: BookmarkNode[]): string[] {
  const refs = pathRefsForFolder(id, nodes);
  return refs.length > 0 && nodes.find((node) => node.id === refs[0]!.id)?.parentId === '0'
    ? refs.slice(1).map((entry) => entry.title)
    : refs.map((entry) => entry.title);
}

function buildAgentRules(
  promptRules: string,
  preferences: CapturePreference[],
  revision?: {
    instruction: string;
    conversation: CaptureRevisionInput['session']['messages'];
    currentPlan?: CapturePlan;
  }
): string {
  const parts = [promptRules.trim()].filter(Boolean);
  if (preferences.length > 0)
    parts.push(
      `本地收藏偏好：${JSON.stringify(
        preferences.slice(0, 8).map((preference) => ({
          kind: preference.kind,
          action: preference.action,
          destinationPath: preference.destinationPath
        }))
      )}`
    );
  if (revision)
    parts.push(
      `当前方案：${JSON.stringify(revision.currentPlan ?? null)}`,
      `本次对话：${JSON.stringify(revision.conversation.slice(-10))}`,
      `用户本次要求：${revision.instruction}`
    );
  return parts.join('\n');
}

function stripPrivateUrlParts(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '');
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function isPathPrefix(prefix: string[], full: string[]): boolean {
  return (
    prefix.length <= full.length &&
    prefix.every(
      (segment, index) =>
        segment.toLocaleLowerCase() === full[index]?.toLocaleLowerCase()
    )
  );
}

function normalizePath(path: string[]): string {
  return path.map((part) => part.trim().toLocaleLowerCase()).join('/');
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 2)
  );
}

function normalizedTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function titleSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  const intersection = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return (2 * intersection) / Math.max(1, leftPairs.size + rightPairs.size);
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1)
    result.add(value.slice(index, index + 2));
  return result;
}

function domainOf(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase();
  } catch {
    return '';
  }
}

function clampTitle(value: string, limit: number, fallback: string): string {
  const clean = value.trim();
  return clean ? Array.from(clean).slice(0, limit).join('') : fallback;
}
