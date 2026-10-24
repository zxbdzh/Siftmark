import type { ProfileRequestState } from './network/profile-limiter';

export interface OrganizationBookmarkInput {
  id: string;
  title: string;
  url: string;
  currentFolderPath: string[];
}

export interface OrganizationFolderPlan {
  path: string[];
  purpose: string;
}

export interface OrganizationAssignment {
  bookmarkId: string;
  folderPath: string[];
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  reason: string;
}

export interface OrganizationSimilarity {
  bookmarkIds: [string, string];
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AiOrganizationContext {
  mode: 'taxonomy' | 'merge-taxonomy' | 'assign' | 'review-similarity';
  bookmarks: OrganizationBookmarkInput[];
  suggestedFolders?: OrganizationFolderPlan[];
  taxonomy?: OrganizationFolderPlan[];
  candidatePairs?: Array<[string, string]>;
  onRequestState?: (state: ProfileRequestState) => void;
}

export interface AiOrganizationResult {
  folders: OrganizationFolderPlan[];
  assignments: OrganizationAssignment[];
  similarities?: OrganizationSimilarity[];
  usageTokens?: number;
}
