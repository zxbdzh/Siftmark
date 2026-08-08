import { describe, expect, it, vi } from 'vitest';
import { createAnalyzeBookmarkHandler } from '../../src/tasks/handlers/analyze-bookmark';
import type { AnalysisCoordinator } from '../../src/ai/analysis-coordinator';

describe('analyze-bookmark task handler', () => {
  it('reports progress and clears page text after handling', async () => {
    const coordinator = { analyze: vi.fn().mockResolvedValue({}) } as unknown as AnalysisCoordinator;
    const input = { snapshot: { id: 'b1', parentId: '0', index: 0, title: 'A', url: 'https://a.test' }, context: { title: 'A', url: 'https://a.test', currentFolderPath: [], pageText: 'private' } };
    const result = await createAnalyzeBookmarkHandler(coordinator)({ task: { id: 't', type: 'analyze-bookmark', state: 'running', input, completed: 0, failed: 0, retryCount: 0, idempotencyKey: 'k', createdAt: 1, updatedAt: 1 }, signal: new AbortController().signal, reportProgress: vi.fn().mockResolvedValue(undefined) });
    expect(result.state).toBe('succeeded');
    expect(input.context.pageText).toBeUndefined();
  });
});
