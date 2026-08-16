import type { BookmarkNode } from '../../bookmarks/types';
import type { AnalysisCoordinator } from '../../ai/analysis-coordinator';
import type { AnalysisProposal } from '../../ai/proposal';
import type {
  TaskHandler,
  TaskHandlerResult,
  TaskProgress
} from '../types';

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
      const proposal = await coordinator.analyze(
        task.input.snapshot,
        task.input.context,
        task.input.profileId
      );
      return finishAnalyzeBookmarkTask(
        proposal,
        task.failed,
        reportProgress
      );
    } catch {
      return { state: 'failed', failed: task.failed + 1 };
    } finally {
      task.input.context.pageText = undefined;
    }
  };
}

export async function finishAnalyzeBookmarkTask(
  proposal: Pick<AnalysisProposal, 'state'>,
  currentFailed: number,
  reportProgress: (progress: TaskProgress) => Promise<void>
): Promise<TaskHandlerResult> {
  if (proposal.state === 'failed')
    return { state: 'failed', failed: currentFailed + 1 };
  await reportProgress({ completed: 1, failed: 0 });
  return { state: 'succeeded', completed: 1 };
}
