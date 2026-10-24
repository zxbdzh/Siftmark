import type { AiAdapterRegistry } from '../ai/adapter-registry';
import type { AiRequestContext, ModelProfile } from '../ai/types';
import type { ProfileRepository } from '../ai/profiles/profile-repository';
import { selectProfileForCapability } from '../ai/profiles/profile-selector';
import { modelProfileKey } from '../ai/profiles/profile-key';
import {
  MODEL_INPUT_LIMITS,
  sanitizeAiRequestContext
} from '../ai/security/model-input-sanitizer';
import type { ChromeSettingsRepository } from '../settings/settings-repository';
import type { MetadataRepository } from '../storage/types';
import type { BookmarkRepository } from './ports';
import { isBookmark, type BookmarkNode } from './types';
import type { ChromeSmartBookmarkHistoryRepository } from './history-repository';
import {
  buildFolderCatalog as buildCaptureFolderCatalog,
  findRelated,
  rankFolderCandidates
} from '../capture-agent/smart-planner';

export interface SmartBookmarkInput {
  url: string;
  title: string;
  bookmarkId?: string;
  description?: string;
  pageText?: string;
  allowNewFolders?: boolean;
  smartRename?: boolean;
  contextNodes?: BookmarkNode[];
  classifyProfile?: ModelProfile;
  classifyProfileKey?: string;
  onProgress?: (update: Partial<SmartBookmarkAnalysis> & {
    phase: 'classifying' | 'validating' | 'moving';
  }) => void;
}

export interface SmartBookmarkAnalysis {
  sourceFolderPath: string[];
  candidateFolderPaths: string[][];
  selectedFolderPath: string[];
  destinationPath: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  summary: string;
  action: 'moved' | 'kept' | 'created';
}

export interface SmartBookmarkResult {
  bookmarkId: string;
  title: string;
  category: string;
  created: boolean;
  analysis?: SmartBookmarkAnalysis;
}

export class SmartBookmarkService {
  constructor(
    private readonly bookmarks: BookmarkRepository,
    private readonly profiles: Pick<ProfileRepository, 'list'>,
    private readonly settings: ChromeSettingsRepository,
    private readonly adapters: AiAdapterRegistry,
    private readonly history: ChromeSmartBookmarkHistoryRepository,
    private readonly metadata?: MetadataRepository,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now
  ) {}

  async save(input: SmartBookmarkInput): Promise<SmartBookmarkResult> {
    if (!isSupportedUrl(input.url)) throw new Error('当前页面不支持智能收藏');
    const [nodes, profiles, assignments, preferences, additionalRules] =
      await Promise.all([
        input.contextNodes ?? this.bookmarks.getTree(),
        this.profiles.list(),
        this.settings.getProfileAssignments(),
        this.settings.getSmartBookmarkSettings(),
        this.settings.getPromptRules()
      ]);
    const classifyProfile = input.classifyProfile
      ? input.classifyProfile.state === 'verified' &&
        input.classifyProfile.capabilities.includes('classify')
        ? input.classifyProfile
        : undefined
      : input.classifyProfileKey
        ? profiles.find(
            (profile) =>
              modelProfileKey(profile) === input.classifyProfileKey &&
              profile.state === 'verified' &&
              profile.capabilities.includes('classify')
          )
        : selectProfileForCapability(
            profiles,
            'classify',
            assignments.classify
          );
    if (!classifyProfile || (input.classifyProfileKey && modelProfileKey(classifyProfile) !== input.classifyProfileKey))
      throw new Error(
        input.classifyProfile || input.classifyProfileKey
          ? '本次整理选择的分类模型不可用'
          : '请先在设置中验证并启用分类模型'
      );
    const source = {
      id: input.bookmarkId ?? '',
      parentId:
        nodes.find((node) => node.id === input.bookmarkId)?.parentId ??
        preferredRoot(nodes).id,
      index: 0,
      title: input.title,
      url: input.url
    };
    const folderCatalog = rankFolderCandidates(
      buildCaptureFolderCatalog(nodes),
      { source, preferences: [], page: { description: input.description } },
      nodes,
      preferences.preferredFolderDepth
    );
    const sourceFolderPath = pathForBookmark(input.bookmarkId, nodes);
    const candidateFolderPaths = folderCatalog
      .slice(0, MODEL_INPUT_LIMITS.folderCandidates)
      .map((entry) => entry.logicalPath);
    input.onProgress?.({ phase: 'classifying', candidateFolderPaths });
    const classification = await this.analyze(classifyProfile, {
      title: input.title,
      url: input.url,
      currentFolderPath: sourceFolderPath,
      description: input.description,
      pageText: input.pageText,
      additionalRules,
      availableFolderPaths: candidateFolderPaths.map((path) => path.join('/')),
      relatedBookmarks: findRelated(source, nodes)
        .slice(0, 5)
        .map((node) => ({
          title: node.title,
          url: node.url,
          summary: `当前目录：${folderPath(node.parentId, nodes).join('/') || '书签栏'}`
        })),
      folderCreationPolicy:
        (input.allowNewFolders ?? preferences.allowNewFolders)
          ? preferences.folderCreationLevel
          : 'off',
      maxTitleLength: preferences.renameMaxLength,
      taskType: 'classify'
    });
    input.onProgress?.({
      phase: 'validating',
      candidateFolderPaths,
      selectedFolderPath: classification.folderPath,
      confidence: classification.confidence,
      reason: classification.reason,
      summary: classification.summary
    });

    let title = input.title;
    if (input.smartRename ?? preferences.smartRename) {
      const renameProfile = assignments.rename
        ? selectProfileForCapability(profiles, 'rename', assignments.rename)
        : classifyProfile.capabilities.includes('rename')
          ? classifyProfile
          : null;
      if (renameProfile) {
        const renamed =
          modelProfileKey(renameProfile) === modelProfileKey(classifyProfile)
            ? classification
            : await this.analyze(renameProfile, {
                title: input.title,
                url: input.url,
                currentFolderPath: [],
                description: input.description,
                pageText: input.pageText,
                maxTitleLength: preferences.renameMaxLength,
                taskType: 'rename'
              });
        title = clampTitle(
          renamed.title,
          preferences.renameMaxLength,
          input.title
        );
      }
    }

    const destination = await this.resolveDestination(
      classification.folderPath,
      nodes,
      input.allowNewFolders ?? preferences.allowNewFolders,
      input.contextNodes ? source.parentId : undefined
    );
    const existing = input.bookmarkId
      ? await this.bookmarks.get(input.bookmarkId)
      : nodes.find((node) => isBookmark(node) && node.url === input.url);
    if (input.bookmarkId && (!existing || !isBookmark(existing)))
      throw new Error('书签已删除，已跳过');
    if (
      input.contextNodes &&
      existing &&
      (existing.url !== input.url ||
        existing.title !== input.title ||
        existing.parentId !== source.parentId)
    )
      throw new Error('书签在整理期间已变更，已保留当前状态');

    const plannedDestinationPath = folderPath(
      destination.id,
      input.contextNodes ?? nodes
    );
    if (!existing || existing.parentId !== destination.id) {
      input.onProgress?.({
        phase: 'moving',
        destinationPath: plannedDestinationPath
      });
    }
    let bookmark: BookmarkNode;
    let created = false;
    if (existing) {
      bookmark =
        existing.parentId === destination.id
          ? existing
          : await this.bookmarks.move(existing.id, destination.id);
      if (bookmark.title !== title)
        bookmark = await this.bookmarks.update(bookmark.id, { title });
    } else {
      bookmark = await this.bookmarks.create({
        parentId: destination.id,
        index: 0,
        title,
        url: input.url
      });
      created = true;
    }

    const destinationPath = folderPath(
      destination.id,
      input.contextNodes ?? (await this.bookmarks.getTree())
    );
    const category = destinationPath.join('/');
    const analysis: SmartBookmarkAnalysis = {
      sourceFolderPath,
      candidateFolderPaths,
      selectedFolderPath: classification.folderPath,
      destinationPath,
      confidence: classification.confidence,
      reason: classification.reason,
      summary: classification.summary,
      action: created
        ? 'created'
        : existing?.parentId === destination.id
          ? 'kept'
          : 'moved'
    };
    if (input.contextNodes)
      return {
        bookmarkId: bookmark.id,
        title: bookmark.title,
        category,
        created,
        analysis
      };
    if (this.metadata) {
      const previous = await this.metadata.get(bookmark.id);
      await this.metadata.put({
        bookmarkId: bookmark.id,
        summary: classification.summary,
        tags: classification.tags,
        note: previous?.note ?? '',
        confidence: classification.confidence,
        reason: classification.reason,
        health: previous?.health ?? 'unchecked',
        updatedAt: this.now()
      });
    }
    await this.history.add({
      id: this.createId(),
      bookmarkId: bookmark.id,
      title: bookmark.title,
      url: input.url,
      category,
      timestamp: this.now()
    });
    return {
      bookmarkId: bookmark.id,
      title: bookmark.title,
      category,
      created,
      analysis
    };
  }

  async rename(
    bookmarkId: string
  ): Promise<{ bookmarkId: string; title: string }> {
    const bookmark = await this.bookmarks.get(bookmarkId);
    if (!bookmark || !isBookmark(bookmark)) throw new Error('书签不存在');
    const [profiles, assignments, preferences] = await Promise.all([
      this.profiles.list(),
      this.settings.getProfileAssignments(),
      this.settings.getSmartBookmarkSettings()
    ]);
    const profile = selectProfileForCapability(
      profiles,
      'rename',
      assignments.rename ?? assignments.classify
    );
    if (!profile) throw new Error('请先在设置中启用支持重命名的模型');
    const result = await this.analyze(profile, {
      title: bookmark.title,
      url: bookmark.url,
      currentFolderPath: [],
      maxTitleLength: preferences.renameMaxLength,
      taskType: 'rename'
    });
    const title = clampTitle(
      result.title,
      preferences.renameMaxLength,
      bookmark.title
    );
    if (title !== bookmark.title)
      await this.bookmarks.update(bookmark.id, { title });
    return { bookmarkId, title };
  }

  private async analyze(profile: ModelProfile, context: AiRequestContext) {
    const adapter = this.adapters.get(profile.protocol);
    if (!adapter) throw new Error('所选模型协议不可用');
    return adapter.analyze(
      profile,
      sanitizeAiRequestContext(context),
      new AbortController().signal
    );
  }

  private async resolveDestination(
    requestedPath: string[],
    nodes: BookmarkNode[],
    allowCreate: boolean,
    fallbackFolderId?: string
  ): Promise<BookmarkNode> {
    const catalog = buildFolderCatalog(nodes);
    const normalized = requestedPath.map((part) => part.trim()).filter(Boolean);
    const matches = catalog.filter(
      (entry) => normalizePath(entry.path) === normalizePath(normalized)
    );
    if (matches.length > 1 && fallbackFolderId) {
      const current = matches.find(
        (entry) => entry.node.id === fallbackFolderId
      );
      if (current) return current.node;
      throw new Error('存在多个同名目录，书签保留原位');
    }
    if (matches[0]) return matches[0].node;
    const root = preferredRoot(nodes);
    if (normalized.length === 0) return root;
    if (!allowCreate) {
      if (fallbackFolderId)
        throw new Error('模型未选择有效的现有目录，书签保留原位');
      return root;
    }
    let parent = root;
    for (const part of normalized.slice(0, 3)) {
      const refreshed = await this.bookmarks.getTree();
      const child = refreshed.find(
        (node) =>
          !isBookmark(node) &&
          node.parentId === parent.id &&
          node.title.trim().toLocaleLowerCase() === part.toLocaleLowerCase()
      );
      parent =
        child ??
        (await this.bookmarks.create({
          parentId: parent.id,
          index: 0,
          title: part
        }));
    }
    return parent;
  }
}

function preferredRoot(nodes: BookmarkNode[]): BookmarkNode {
  const roots = nodes.filter(
    (node) => !isBookmark(node) && node.parentId === '0'
  );
  const preferred = roots.find((node) =>
    /书签栏|收藏夹栏|bookmarks bar/i.test(node.title)
  );
  const root = preferred ?? roots[0];
  if (!root) throw new Error('未找到浏览器书签栏');
  return root;
}

function buildFolderCatalog(nodes: BookmarkNode[]) {
  const rootIds = new Set(
    nodes.filter((node) => node.parentId === '0').map((node) => node.id)
  );
  return nodes
    .filter(
      (node) => !isBookmark(node) && node.id !== '0' && !rootIds.has(node.id)
    )
    .map((node) => ({ node, path: folderPath(node.id, nodes) }));
}

function folderPath(id: string, nodes: BookmarkNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parts: string[] = [];
  let current = byId.get(id);
  while (current && current.id !== '0' && current.parentId !== '0') {
    if (current.title) parts.unshift(current.title);
    current = byId.get(current.parentId);
  }
  return parts;
}

function pathForBookmark(
  id: string | undefined,
  nodes: BookmarkNode[]
): string[] {
  const bookmark = id ? nodes.find((node) => node.id === id) : undefined;
  return bookmark ? folderPath(bookmark.parentId, nodes) : [];
}

function normalizePath(path: string[]): string {
  return path.map((part) => part.trim().toLocaleLowerCase()).join('/');
}

function clampTitle(value: string, limit: number, fallback: string): string {
  const clean = value.trim();
  return clean ? Array.from(clean).slice(0, limit).join('') : fallback;
}

function isSupportedUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
