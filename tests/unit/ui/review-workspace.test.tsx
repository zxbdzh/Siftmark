import { afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReviewWorkspace } from '../../../src/ui/review/ReviewWorkspace';
import type { AnalysisProposal } from '../../../src/ai/proposal';
const proposal: AnalysisProposal = { id: 'p', bookmarkId: 'b', sourceSnapshot: { id: 'b', parentId: '0', index: 0, title: '旧' }, result: { folderPath: [], title: '新', tags: [], summary: '', confidence: 'low', reason: '复核' }, state: 'pending', createdAt: 1 };
afterEach(cleanup);
describe('ReviewWorkspace', () => {
  it('shows confidence and apply controls without percentages', () => { render(<ReviewWorkspace proposals={[proposal]} onApply={vi.fn()} onReject={vi.fn()}/>); expect(screen.getAllByText(/低置信度/).length).toBeGreaterThan(0); expect(screen.queryByText(/%/)).not.toBeInTheDocument(); });

  it('applies every visible proposal through the normal field-level callback', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<ReviewWorkspace proposals={[proposal]} onApply={onApply} onReject={vi.fn()}/>);
    await userEvent.click(screen.getByRole('button', { name: '接受当前 1 项' }));
    expect(onApply).toHaveBeenCalledWith('p', ['title', 'folder', 'tags', 'summary']);
    expect(await screen.findByText('已接受 1 个提案')).toBeVisible();
  });
});
