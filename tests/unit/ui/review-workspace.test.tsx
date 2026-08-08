import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewWorkspace } from '../../../src/ui/review/ReviewWorkspace';
import type { AnalysisProposal } from '../../../src/ai/proposal';
const proposal: AnalysisProposal = { id: 'p', bookmarkId: 'b', sourceSnapshot: { id: 'b', parentId: '0', index: 0, title: '旧' }, result: { folderPath: [], title: '新', tags: [], summary: '', confidence: 'low', reason: '复核' }, state: 'pending', createdAt: 1 };
describe('ReviewWorkspace', () => { it('shows confidence and apply controls without percentages', () => { render(<ReviewWorkspace proposals={[proposal]} onApply={vi.fn()} onReject={vi.fn()}/>); expect(screen.getAllByText(/低置信度/).length).toBeGreaterThan(0); expect(screen.queryByText(/%/)).not.toBeInTheDocument(); }); });
