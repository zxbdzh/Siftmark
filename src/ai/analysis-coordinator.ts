import type { BookmarkRepository } from '../bookmarks/ports';
import type { BookmarkNode } from '../bookmarks/types';
import { RuleEngine } from '../rules/rule-engine';
import type { RuleAction } from '../rules/types';
import type { ModelProfile } from './types';
import type { AiRequestContext, AiAnalysisResult } from './types';
import { AiAdapterRegistry } from './adapter-registry';
import { selectProfileForCapability } from './profiles/profile-selector';
import type { ProposalRepository, AnalysisProposal } from './proposal';

export interface AnalysisCoordinatorDeps {
  bookmarks: BookmarkRepository;
  profiles: ModelProfile[];
  adapters: AiAdapterRegistry;
  proposals: ProposalRepository;
  rules?: RuleEngine;
  now?: () => number;
  createId?: () => string;
}

export class AnalysisCoordinator {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly deps: AnalysisCoordinatorDeps) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? (() => crypto.randomUUID());
  }

  async analyze(snapshot: BookmarkNode, context: AiRequestContext, preferredProfileId?: string): Promise<AnalysisProposal> {
    const current = await this.deps.bookmarks.get(snapshot.id);
    if (!current || current.title !== snapshot.title || current.url !== snapshot.url || current.parentId !== snapshot.parentId || current.index !== snapshot.index) {
      return this.save(snapshot, fallbackResult(snapshot), 'conflict');
    }
    const evaluation = this.deps.rules?.evaluate({ url: snapshot.url ?? '', title: snapshot.title, sourceFolderId: snapshot.parentId });
    const terminal = evaluation?.terminalAction;
    if (terminal?.type === 'skip-ai' || terminal?.type === 'send-to-inbox') {
      return this.save(snapshot, ruleResult(snapshot, evaluation?.actions ?? []), 'auto-approved');
    }
    const profile = selectProfileForCapability(this.deps.profiles, 'classify', preferredProfileId);
    if (!profile) return this.save(snapshot, fallbackResult(snapshot), 'failed');
    const adapter = this.deps.adapters.get(profile.protocol);
    if (!adapter) return this.save(snapshot, fallbackResult(snapshot), 'failed');
    try {
      const result = await adapter.analyze(profile, context, new AbortController().signal);
      return this.save(snapshot, result, result.confidence === 'high' ? 'auto-approved' : 'pending');
    } catch {
      return this.save(snapshot, fallbackResult(snapshot), 'failed');
    }
  }

  private async save(sourceSnapshot: BookmarkNode, result: AiAnalysisResult, state: AnalysisProposal['state']): Promise<AnalysisProposal> {
    const proposal: AnalysisProposal = { id: this.createId(), bookmarkId: sourceSnapshot.id, sourceSnapshot, result, state, createdAt: this.now() };
    await this.deps.proposals.put(proposal);
    return proposal;
  }
}

function fallbackResult(snapshot: BookmarkNode): AiAnalysisResult {
  return { folderPath: [], title: snapshot.title, tags: [], summary: '', confidence: 'low', reason: '需要人工审核' };
}

function ruleResult(snapshot: BookmarkNode, actions: RuleAction[]): AiAnalysisResult {
  return { folderPath: [], title: snapshot.title, tags: actions.filter((action): action is { type: 'tag'; tag: string } => action.type === 'tag').map((action) => action.tag), summary: '', confidence: 'high', reason: '命中本地规则' };
}
