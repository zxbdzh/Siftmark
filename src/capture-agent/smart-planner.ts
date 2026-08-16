import type { AiAdapterRegistry } from '../ai/adapter-registry';
import type { ProfileRepository } from '../ai/profiles/profile-repository';
import { selectProfileForCapability } from '../ai/profiles/profile-selector';
import {
  redactUrlForModel,
  sanitizeAiRequestContext
} from '../ai/security/model-input-sanitizer';
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
    const activitySuffix = revision
      ? `-revision-${revision.conversation.filter((item) => item.role === 'user').length}`
      : '';
    await input.reportActivity?.({
      id: `folder-candidates${activitySuffix}`,
      kind: 'folders',
      status: 'running',
      label: '正在比较候选目录'
    });
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
        url: bookmark.url,
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
    await input.reportActivity?.({
      id: `folder-candidates${activitySuffix}`,
      kind: 'folders',
      status: 'completed',
      label: '已比较候选目录',
      detail: `比较了 ${availableFolderPaths.length} 个相关目录，并结合目录深度与本地偏好排序`,
      facts: [
        { label: '目录总数', value: `${catalog.length} 个` },
        { label: '送入模型', value: `${availableFolderPaths.length} 个候选` },
        { label: '本地信号', value: `${input.preferences.length} 条偏好或记忆` },
        { label: '推荐深度', value: `${settings.preferredFolderDepth} 级` },
        {
          label: '优先候选',
          value: availableFolderPaths.slice(0, 3).join('；') || '书签栏'
        }
      ]
    });
    const currentFolderPath = logicalPathForFolder(
      input.source.parentId,
      nodes
    );
    const supportsOpenAiEnhancements =
      profile.protocol === 'openai-chat' ||
      profile.protocol === 'openai-responses';
    const useVision = Boolean(
      settings.enableVision &&
      supportsOpenAiEnhancements &&
      input.page?.imageDataUrl
    );
    const useWebSearch = settings.enableWebSearch && supportsOpenAiEnhancements;
    if (settings.enableVision)
      await input.reportActivity?.({
        id: `vision${activitySuffix}`,
        kind: 'vision',
        status: useVision ? 'running' : 'skipped',
        label: useVision ? '正在识别页面截图' : '本次未使用页面识图',
        detail: !supportsOpenAiEnhancements
          ? '当前模型协议尚未接入多模态图片输入'
          : !input.page?.imageDataUrl
            ? '页面策略、标签页状态或截图大小不允许发送截图'
            : undefined,
        facts: useVision
          ? [
              { label: '图片范围', value: '当前标签页可见区域' },
              {
                label: '临时输入',
                value: imagePayloadLabel(input.page?.imageDataUrl)
              },
              { label: '模型协议', value: protocolLabel(profile.protocol) }
            ]
          : undefined
      });
    if (settings.enableWebSearch)
      await input.reportActivity?.({
        id: `web-search${activitySuffix}`,
        kind: 'web-search',
        status: useWebSearch ? 'running' : 'skipped',
        label: useWebSearch ? '正在请求联网搜索' : '本次未使用联网搜索',
        detail: supportsOpenAiEnhancements
          ? undefined
          : '当前模型协议尚未接入联网工具参数',
        facts: useWebSearch
          ? [
              { label: '搜索策略', value: '要求模型使用联网检索' },
              { label: '模型协议', value: protocolLabel(profile.protocol) }
            ]
          : undefined
      });
    const context: AiRequestContext = sanitizeAiRequestContext({
      title: input.source.title,
      url: input.source.url,
      currentFolderPath,
      description: input.page?.description ?? '',
      pageText: input.page?.text ?? '',
      ...(useVision ? { imageDataUrl: input.page?.imageDataUrl } : {}),
      ...(useWebSearch ? { webSearch: true } : {}),
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
    });
    await input.reportActivity?.({
      id: `model-analysis${activitySuffix}`,
      kind: 'model',
      status: 'running',
      label: revision ? 'AI 正在重新规划方案' : 'AI 正在生成归类方案',
      facts: [
        { label: '模型', value: `${profile.name} · ${profile.model}` },
        {
          label: '上下文',
          value: `${Array.from(context.pageText ?? '').length} 字符正文，${availableFolderPaths.length} 个目录，${relatedContext.length} 个相关收藏`
        },
        {
          label: '增强工具',
          value: [useVision ? '页面识图' : '', useWebSearch ? '联网搜索' : '']
            .filter(Boolean)
            .join('、') || '未启用'
        }
      ]
    });
    const analysis = await adapter.analyze(
      profile,
      context,
      new AbortController().signal
    );
    if (useVision)
      await input.reportActivity?.({
        id: `vision${activitySuffix}`,
        kind: 'vision',
        status: analysis.toolUsage?.vision ? 'completed' : 'skipped',
        label: analysis.toolUsage?.vision
          ? '页面截图识别完成'
          : '模型服务未确认图片输入',
        detail: analysis.toolUsage?.vision
          ? '当前可见区域仅用于本次判断，未写入收藏会话'
          : '中转服务可能忽略了图片输入',
        facts: [
          {
            label: '服务确认',
            value: analysis.toolUsage?.vision
              ? '图片输入已接受'
              : '未确认图片输入'
          },
          { label: '持久化', value: '截图未写入收藏会话' }
        ]
      });
    if (useWebSearch) {
      const webSearchUsage = analysis.toolUsage?.webSearch;
      await input.reportActivity?.({
        id: `web-search${activitySuffix}`,
        kind: 'web-search',
        status:
          webSearchUsage === 'used' || webSearchUsage === 'requested'
            ? 'completed'
            : 'skipped',
        label:
          webSearchUsage === 'used'
            ? '联网搜索完成'
            : webSearchUsage === 'requested'
              ? '已请求联网搜索'
              : '模型未返回联网调用记录',
        detail:
          webSearchUsage === 'used'
            ? '模型服务返回了标准 web_search 工具调用记录'
            : webSearchUsage === 'requested'
              ? '当前格式不提供可验证的标准搜索调用记录'
              : '模型可能判断无需搜索，或中转未返回工具轨迹',
        facts: [
          {
            label: '工具证据',
            value:
              webSearchUsage === 'used'
                ? '返回标准搜索调用记录'
                : webSearchUsage === 'requested'
                  ? '请求已发送，协议不返回调用明细'
                  : '未返回可验证的搜索记录'
          }
        ]
      });
    }
    await input.reportActivity?.({
      id: `model-analysis${activitySuffix}`,
      kind: 'model',
      status: 'completed',
      label: revision ? 'AI 已生成调整方案' : 'AI 已生成归类方案',
      detail: safeTraceDetail(analysis.reason),
      facts: [
        {
          label: '建议位置',
          value: analysis.folderPath.join(' / ') || '书签栏'
        },
        { label: '置信度', value: confidenceLabel(analysis.confidence) },
        {
          label: '建议标题',
          value: safeTraceDetail(analysis.title)
        },
        {
          label: '内容标签',
          value: analysis.tags.slice(0, 5).join('、') || '无'
        }
      ]
    });
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
        ? clampTitle(
            analysis.title,
            settings.renameMaxLength,
            input.source.title
          )
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
          input.page?.description?.trim() ||
          input.page?.text?.trim() ||
          input.page?.imageDataUrl
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
      const tokenScore = [...terms].filter((term) =>
        title.includes(term)
      ).length;
      const depthDistance = Math.abs(
        entry.logicalPath.length - preferredFolderDepth
      );
      const score =
        preferenceScore(input.preferences, normalized) +
        (normalized === currentPath ? 20 : 0) +
        tokenScore * 4 -
        depthDistance * 0.25;
      return { entry, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.logicalPath
          .join('/')
          .localeCompare(right.entry.logicalPath.join('/'), 'zh-CN')
    )
    .slice(0, MAX_FOLDER_CANDIDATES)
    .map(({ entry }) => entry);
}

function preferenceScore(
  preferences: CapturePreference[],
  normalizedPath: string
): number {
  return preferences.reduce((score, preference) => {
    if (normalizePath(preference.destinationPath) !== normalizedPath)
      return score;
    const strength =
      preference.kind === 'fixed-rule'
        ? 160
        : preference.kind === 'learned'
          ? 110 + Math.min(20, preference.evidenceCount ?? 0)
          : 60;
    return score + (preference.action === 'prefer-folder' ? strength : -strength);
  }, 0);
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
  const requested = requestedPath
    .map((segment) => segment.trim())
    .filter(Boolean);
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
    .filter((entry) => isPathPrefix(entry.logicalPath, requested))
    .sort(
      (left, right) => right.logicalPath.length - left.logicalPath.length
    )[0];
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
  return refs.length > 0 &&
    nodes.find((node) => node.id === refs[0]!.id)?.parentId === '0'
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
          destinationPath: preference.destinationPath,
          ...(preference.kind === 'learned'
            ? {
                evidenceCount: preference.evidenceCount,
                confidence: preference.confidence,
                summary: preference.reviewSummary
              }
            : {})
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

function safeTraceDetail(value: string): string {
  const redacted = redactSensitiveText(value).replace(
    /https?:\/\/[^\s<>"']+/gi,
    (url) => redactUrlForModel(url)
  );
  return Array.from(redacted.trim()).slice(0, 300).join('');
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
  const intersection = [...leftPairs].filter((pair) =>
    rightPairs.has(pair)
  ).length;
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

function confidenceLabel(value: CapturePlan['confidence']): string {
  if (value === 'high') return '高';
  if (value === 'medium') return '中';
  if (value === 'low') return '低';
  return '未知';
}

function protocolLabel(value: string): string {
  if (value === 'openai-responses') return 'OpenAI Responses';
  if (value === 'openai-chat') return 'OpenAI Chat Completions';
  if (value === 'anthropic-messages') return 'Anthropic Messages';
  if (value === 'gemini-generate-content') return 'Gemini GenerateContent';
  return value;
}

function imagePayloadLabel(value: string | undefined): string {
  if (!value) return '未提供';
  const base64 = value.split(',', 2)[1] ?? '';
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4));
  return bytes >= 1024
    ? `约 ${(bytes / 1024).toFixed(0)} KB`
    : `约 ${bytes} B`;
}
