import type { BookmarkCommandService } from '../../operations/bookmark-command-service';
import type { MetadataRepository } from '../../storage/types';
import type { ProposalRepository } from '../../ai/proposal';

export class ReviewService {
  constructor(private readonly proposals: ProposalRepository, private readonly commands: BookmarkCommandService, private readonly metadata: MetadataRepository) {}

  async applyProposal(input: { proposalId: string; fields: Array<'title' | 'folder' | 'tags' | 'summary'> }): Promise<void> {
    const proposal = await this.proposals.get(input.proposalId);
    if (!proposal) throw new Error('Proposal not found');
    if (proposal.category === 'duplicate') {
      const rows = await Promise.all((proposal.relatedBookmarkIds ?? []).map((bookmarkId) => this.metadata.get(bookmarkId)));
      const current = rows.find((row) => row?.bookmarkId === proposal.bookmarkId) ?? await this.metadata.get(proposal.bookmarkId);
      const tags = [...new Set(rows.flatMap((row) => row?.tags ?? []))];
      const notes = [...new Set(rows.map((row) => row?.note.trim()).filter((note): note is string => Boolean(note)))];
      const summaries = rows.map((row) => row?.summary.trim()).filter((summary): summary is string => Boolean(summary));
      await this.commands.updateMetadata({ bookmarkId: proposal.bookmarkId, summary: current?.summary || summaries[0] || '', tags, note: notes.join('\n\n'), confidence: current?.confidence ?? 'unknown', reason: '用户确认重复项元数据合并', health: current?.health ?? 'unchecked', updatedAt: Date.now() });
      await this.proposals.put({ ...proposal, state: 'approved' });
      return;
    }
    if (proposal.category === 'dead') { await this.proposals.put({ ...proposal, state: 'approved' }); return; }
    if (input.fields.includes('title')) {
      const result = await this.commands.rename({ bookmarkId: proposal.bookmarkId, title: proposal.result.title, expectedTitle: proposal.sourceSnapshot.title });
      if (result && !result.ok) throw new Error('书签标题已变化，请重新审核');
    }
    if (input.fields.includes('folder')) {
      const folderId = proposal.result.folderPath.at(-1);
      if (folderId) {
        const result = await this.commands.move({ bookmarkId: proposal.bookmarkId, parentId: folderId, expected: { parentId: proposal.sourceSnapshot.parentId, index: proposal.sourceSnapshot.index } });
        if (result && !result.ok) throw new Error('书签位置已变化，请重新审核');
      }
    }
    if (input.fields.includes('tags') || input.fields.includes('summary')) {
      const current = await this.metadata.get(proposal.bookmarkId);
      await this.commands.updateMetadata({ bookmarkId: proposal.bookmarkId, summary: input.fields.includes('summary') ? proposal.result.summary : current?.summary ?? '', tags: input.fields.includes('tags') ? proposal.result.tags : current?.tags ?? [], note: current?.note ?? '', confidence: proposal.result.confidence, reason: proposal.result.reason, health: current?.health ?? 'unchecked', updatedAt: Date.now() });
    }
    await this.proposals.put({ ...proposal, state: 'approved' });
  }

  async reject(proposalId: string): Promise<void> {
    const proposal = await this.proposals.get(proposalId);
    if (proposal) await this.proposals.put({ ...proposal, state: 'rejected' });
  }
}
