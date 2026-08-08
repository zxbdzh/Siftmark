import type { BookmarkId, BookmarkNode } from '../bookmarks/types';
import type { SiftmarkDatabase } from '../storage/database';
import type { AnalysisProposalRecord } from '../storage/schema';
import type { AiAnalysisResult } from './types';

export interface AnalysisProposal {
  id: string;
  bookmarkId: BookmarkId;
  sourceSnapshot: BookmarkNode;
  result: AiAnalysisResult;
  state: 'pending' | 'auto-approved' | 'approved' | 'rejected' | 'conflict' | 'failed';
  createdAt: number;
}

export interface ProposalRepository {
  get(id: string): Promise<AnalysisProposal | null>;
  list(): Promise<AnalysisProposal[]>;
  put(proposal: AnalysisProposal): Promise<void>;
}

export class DexieProposalRepository implements ProposalRepository {
  constructor(private readonly db: SiftmarkDatabase) {}

  async get(id: string): Promise<AnalysisProposal | null> {
    const record = await this.db.analysisProposals.get(id);
    return record ? record as unknown as AnalysisProposal : null;
  }

  async list(): Promise<AnalysisProposal[]> {
    return this.db.analysisProposals.orderBy('createdAt').reverse().toArray() as unknown as Promise<AnalysisProposal[]>;
  }

  async put(proposal: AnalysisProposal): Promise<void> {
    const record: AnalysisProposalRecord = {
      id: proposal.id,
      bookmarkId: proposal.bookmarkId,
      sourceSnapshot: proposal.sourceSnapshot as unknown as Record<string, unknown>,
      result: proposal.result as unknown as Record<string, unknown>,
      state: proposal.state,
      createdAt: proposal.createdAt
    };
    await this.db.analysisProposals.put(record);
  }
}
