import type { OrganizationBookmarkInput } from '../ai/organization-types';
import type { OrganizationPlan } from '../bookmarks/organization-planner';
import { organizationPathKey } from '../bookmarks/organization-planner';
import type { CapturePreference } from './types';

export function applyOrganizationExperience(
  plan: OrganizationPlan,
  bookmarks: Array<Pick<OrganizationBookmarkInput, 'id' | 'url'>>,
  memories: CapturePreference[]
): OrganizationPlan {
  const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const plannedPaths = new Set(plan.folders.map((folder) => organizationPathKey(folder.path)));
  return {
    ...plan,
    assignments: plan.assignments.map((assignment) => {
      const bookmark = byId.get(assignment.bookmarkId);
      if (!bookmark) return assignment;
      const domain = new URL(bookmark.url).hostname.toLocaleLowerCase();
      const memory = memories.find((candidate) => candidate.domain === domain && !candidate.queryTokens?.length &&
        candidate.action === 'prefer-folder' && plannedPaths.has(organizationPathKey(candidate.destinationPath)));
      // 沿用整批固定分类树；不能因旧偏好创建规划外路径或跳过整批确认。
      if (!memory || organizationPathKey(memory.destinationPath) === organizationPathKey(assignment.folderPath)) return assignment;
      return { ...assignment, folderPath: [...memory.destinationPath], confidence: 'medium' as const,
        reason: `本地经验：${memory.reviewSummary ?? '用户已确认的偏好'}；${assignment.reason}`.slice(0, 120) };
    })
  };
}
