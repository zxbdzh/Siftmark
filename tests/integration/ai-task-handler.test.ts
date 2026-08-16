import { describe, expect, it, vi } from 'vitest';
import { createAnalyzeBookmarkHandler } from '../../src/tasks/handlers/analyze-bookmark';
import type { AnalysisCoordinator } from '../../src/ai/analysis-coordinator';

describe('analyze-bookmark task handler', () => {
  it('reports progress and clears page text after handling', async () => {
    const coordinator = {
      analyze: vi.fn().mockResolvedValue({ state: 'pending' })
    } as unknown as AnalysisCoordinator;
    const input = { snapshot: { id: 'b1', parentId: '0', index: 0, title: 'A', url: 'https://a.test' }, context: { title: 'A', url: 'https://a.test', currentFolderPath: [], pageText: 'private' } };
    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const result = await createAnalyzeBookmarkHandler(coordinator)({ task: { id: 't', type: 'analyze-bookmark', state: 'running', input, completed: 0, failed: 0, retryCount: 0, idempotencyKey: 'k', createdAt: 1, updatedAt: 1 }, signal: new AbortController().signal, reportProgress });
    expect(result.state).toBe('succeeded');
    expect(reportProgress).toHaveBeenLastCalledWith({ completed: 1, failed: 0 });
    expect(input.context.pageText).toBeUndefined();
  });

  it('reports a persisted failed proposal as a failed task', async () => {
    const coordinator = {
      analyze: vi.fn().mockResolvedValue({ state: 'failed' })
    } as unknown as AnalysisCoordinator;
    const input = {
      snapshot: {
        id: 'b1',
        parentId: '0',
        index: 0,
        title: 'A',
        url: 'https://a.test'
      },
      context: {
        title: 'A',
        url: 'https://a.test',
        currentFolderPath: [],
        pageText: 'private'
      }
    };
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    const result = await createAnalyzeBookmarkHandler(coordinator)({
      task: {
        id: 't',
        type: 'analyze-bookmark',
        state: 'running',
        input,
        completed: 0,
        failed: 2,
        retryCount: 0,
        idempotencyKey: 'k',
        createdAt: 1,
        updatedAt: 1
      },
      signal: new AbortController().signal,
      reportProgress
    });

    expect(result).toEqual({ state: 'failed', failed: 3 });
    expect(coordinator.analyze).toHaveBeenCalledTimes(1);
    expect(reportProgress).toHaveBeenCalledTimes(1);
    expect(reportProgress).toHaveBeenCalledWith({ completed: 0, failed: 0 });
    expect(input.context.pageText).toBeUndefined();
  });
});
