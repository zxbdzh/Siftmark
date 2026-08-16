import type { BookmarkRepository } from '../bookmarks/ports';
import type { BookmarkNode } from '../bookmarks/types';
import { RuleEngine } from '../rules/rule-engine';
import type { RuleAction } from '../rules/types';
import type { AiCapability, ModelProfile } from './types';
import type { AiRequestContext, AiAnalysisResult } from './types';
import { AiAdapterRegistry } from './adapter-registry';
import { selectProfileForCapability } from './profiles/profile-selector';
import { modelProfileKey } from './profiles/profile-key';
import type { ProposalRepository, AnalysisProposal } from './proposal';
import { sanitizeAiRequestContext } from './security/model-input-sanitizer';

export interface AnalysisCoordinatorDeps {
  bookmarks: BookmarkRepository;
  profiles: ModelProfile[];
  adapters: AiAdapterRegistry;
  proposals: ProposalRepository;
  rules?: RuleEngine;
  now?: () => number;
  createId?: () => string;
}

export type PreferredProfileSelection =
  string | Partial<Record<AiCapability, string>>;

export class AnalysisCoordinator {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly deps: AnalysisCoordinatorDeps) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? (() => crypto.randomUUID());
  }

  async analyze(
    snapshot: BookmarkNode,
    context: AiRequestContext,
    preferredProfiles?: PreferredProfileSelection
  ): Promise<AnalysisProposal> {
    const current = await this.deps.bookmarks.get(snapshot.id);
    if (
      !current ||
      current.title !== snapshot.title ||
      current.url !== snapshot.url ||
      current.parentId !== snapshot.parentId ||
      current.index !== snapshot.index
    ) {
      return this.save(snapshot, fallbackResult(snapshot), 'conflict');
    }
    const evaluation = this.deps.rules?.evaluate({
      url: snapshot.url ?? '',
      title: snapshot.title,
      sourceFolderId: snapshot.parentId
    });
    const terminal = evaluation?.terminalAction;
    if (terminal?.type === 'skip-ai' || terminal?.type === 'send-to-inbox') {
      return this.save(
        snapshot,
        ruleResult(snapshot, evaluation?.actions ?? []),
        'auto-approved'
      );
    }
    const usesExplicitAssignments =
      typeof preferredProfiles === 'object' && preferredProfiles !== null;
    const preferred =
      typeof preferredProfiles === 'string'
        ? { classify: preferredProfiles }
        : (preferredProfiles ?? {});
    const classifyProfile =
      usesExplicitAssignments && !preferred.classify
        ? null
        : selectProfileForCapability(
            this.deps.profiles,
            'classify',
            preferred.classify
          );
    if (!classifyProfile)
      return this.save(snapshot, fallbackResult(snapshot), 'failed');
    const renameProfile = selectTaskProfile(
      this.deps.profiles,
      'rename',
      preferred.rename,
      classifyProfile,
      usesExplicitAssignments
    );
    const summarizeProfile = selectTaskProfile(
      this.deps.profiles,
      'summarize',
      preferred.summarize,
      classifyProfile,
      usesExplicitAssignments
    );
    const results = new Map<string, Promise<AiAnalysisResult>>();
    const sanitizedContext = sanitizeAiRequestContext(context);
    const analyzeWith = (profile: ModelProfile) => {
      const key = modelProfileKey(profile);
      const existing = results.get(key);
      if (existing) return existing;
      const adapter = this.deps.adapters.get(profile.protocol);
      const request = adapter
        ? adapter.analyze(
            profile,
            sanitizedContext,
            new AbortController().signal
          )
        : Promise.reject(new Error('AI adapter unavailable'));
      results.set(key, request);
      return request;
    };
    try {
      const classification = await analyzeWith(classifyProfile);
      const [renaming, summary] = await Promise.all([
        renameProfile
          ? analyzeWith(renameProfile).catch(() => null)
          : Promise.resolve(null),
        summarizeProfile
          ? analyzeWith(summarizeProfile).catch(() => null)
          : Promise.resolve(null)
      ]);
      const result: AiAnalysisResult = {
        ...classification,
        title: renaming?.title ?? snapshot.title,
        summary: summary?.summary ?? ''
      };
      return this.save(
        snapshot,
        result,
        result.confidence === 'high' ? 'auto-approved' : 'pending'
      );
    } catch {
      return this.save(snapshot, fallbackResult(snapshot), 'failed');
    }
  }

  private async save(
    sourceSnapshot: BookmarkNode,
    result: AiAnalysisResult,
    state: AnalysisProposal['state']
  ): Promise<AnalysisProposal> {
    const proposal: AnalysisProposal = {
      id: this.createId(),
      bookmarkId: sourceSnapshot.id,
      sourceSnapshot,
      result,
      state,
      createdAt: this.now()
    };
    await this.deps.proposals.put(proposal);
    return proposal;
  }
}

function selectTaskProfile(
  profiles: ModelProfile[],
  capability: 'rename' | 'summarize',
  preferredKey: string | undefined,
  classifyProfile: ModelProfile,
  usesExplicitAssignments: boolean
): ModelProfile | null {
  if (preferredKey)
    return selectProfileForCapability(profiles, capability, preferredKey);
  if (usesExplicitAssignments) return null;
  return classifyProfile.capabilities.includes(capability)
    ? classifyProfile
    : null;
}

function fallbackResult(snapshot: BookmarkNode): AiAnalysisResult {
  return {
    folderPath: [],
    title: snapshot.title,
    tags: [],
    summary: '',
    confidence: 'low',
    reason: '需要人工审核'
  };
}

function ruleResult(
  snapshot: BookmarkNode,
  actions: RuleAction[]
): AiAnalysisResult {
  return {
    folderPath: [],
    title: snapshot.title,
    tags: actions
      .filter(
        (action): action is { type: 'tag'; tag: string } =>
          action.type === 'tag'
      )
      .map((action) => action.tag),
    summary: '',
    confidence: 'high',
    reason: '命中本地规则'
  };
}
