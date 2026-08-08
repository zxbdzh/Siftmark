import type { BookmarkNode } from '../../bookmarks/types';
import type { AnalysisCoordinator } from '../../ai/analysis-coordinator';
import type { TaskHandler } from '../types';

export interface AnalyzeBookmarkInput {
  snapshot: BookmarkNode;
  context: { title: string; url: string; currentFolderPath: string[]; description?: string; pageText?: string; additionalRules?: string };
  profileId?: string;
}

export function createAnalyzeBookmarkHandler(coordinator: AnalysisCoordinator): TaskHandler<AnalyzeBookmarkInput> {
  return async ({ task, reportProgress, signal }) => {
    await reportProgress({ completed: 0, failed: 0 });
    if (signal.aborted) return { state: 'cancelled' };
    try {
      await coordinator.analyze(task.input.snapshot, task.input.context, task.input.profileId);
      await reportProgress({ completed: 1, failed: 0 });
      return { state: 'succeeded', completed: 1 };
    } catch {
      return { state: 'failed', failed: task.failed + 1 };
    } finally {
      task.input.context.pageText = undefined;
    }
  };
}
