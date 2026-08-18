import type { BookmarkNode } from '../bookmarks/types';
import type { Confidence } from '../storage/types';

export const CAPTURE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export type CaptureTrigger =
  'native-bookmark' | 'keyboard-command' | 'context-menu' | 'popup';

export type CaptureSessionState =
  | 'analyzing'
  | 'ready'
  | 'pending'
  | 'adjusting'
  | 'executing'
  | 'applied'
  | 'rejected'
  | 'failed'
  | 'ended'
  | 'expired'
  | 'undone';

export type CaptureRiskReason =
  | 'new-folder'
  | 'multi-level-folder-creation'
  | 'unclear-destination'
  | 'low-confidence'
  | 'exact-duplicate'
  | 'similar-bookmark'
  | 'rule-conflict'
  | 'large-title-change'
  | 'special-folder'
  | 'insufficient-page-information'
  | 'stale-state';

export interface CaptureRiskAssessment {
  decision: 'auto' | 'approval';
  reasons: CaptureRiskReason[];
  canExecute: boolean;
}

export interface CaptureFolderRef {
  id: string;
  title: string;
}

export interface CaptureDestination {
  /** The existing folder that receives the bookmark or the first new leaf. */
  folderId: string;
  path: CaptureFolderRef[];
  /** Folder names to create below folderId, in order. */
  newFolders: string[];
  creationSource?: 'automatic' | 'explicit-user';
  /** Maximum folder levels approved when this plan was generated. */
  maxNewFolderLevels?: number;
}

export interface CaptureRelatedBookmark {
  id: string;
  title: string;
  url: string;
  relation: 'exact' | 'similar';
}

export interface CapturePlan {
  destination: CaptureDestination;
  title: string;
  tags: string[];
  summary: string;
  confidence: Confidence;
  reason: string;
  relatedBookmarks: CaptureRelatedBookmark[];
  generatedAt: number;
  riskHints?: {
    ruleConflict?: boolean;
    titleMeaningPreserved?: boolean;
    pageInformation?: 'sufficient' | 'insufficient';
  };
  memoryInfluence?: CaptureMemoryInfluence;
}

export interface CaptureMemoryInfluence {
  matched: CaptureMemoryMatch[];
  adoptedMemoryIds: string[];
}

export interface CaptureMemoryMatch {
  id: string;
  domain: string;
  action: 'prefer-folder' | 'avoid-folder';
  destinationFolderId?: string;
  destinationPath: string[];
  evidenceCount: number;
  confidence: Confidence;
  reviewSummary: string;
}

export interface CaptureMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

export interface CaptureFailure {
  kind: 'network' | 'configuration' | 'schema' | 'conflict' | 'unknown';
  message: string;
  retryable: boolean;
  retryCount: number;
}

export type CaptureActivityKind =
  | 'capture'
  | 'page'
  | 'folders'
  | 'model'
  | 'vision'
  | 'web-search'
  | 'risk'
  | 'execution';

export type CaptureActivityStatus =
  'running' | 'completed' | 'skipped' | 'failed';

export interface CaptureActivityFact {
  label: string;
  value: string;
}

/**
 * A safe, user-facing audit event. It records what the Agent did and a short
 * conclusion, never provider reasoning tokens, prompts, page bodies or raw
 * model responses.
 */
export interface CaptureActivity {
  id: string;
  kind: CaptureActivityKind;
  status: CaptureActivityStatus;
  label: string;
  detail?: string;
  /** Small, redacted evidence fields suitable for a local audit timeline. */
  facts?: CaptureActivityFact[];
  createdAt: number;
  updatedAt: number;
  durationMs?: number;
}

export type CaptureActivityDraft = Omit<
  CaptureActivity,
  'createdAt' | 'updatedAt' | 'durationMs'
>;

export type CaptureResolution =
  'auto' | 'allowed' | 'rejected' | 'ended' | 'expired' | 'undone';

export interface CaptureSession {
  id: string;
  bookmarkId: string;
  trigger: CaptureTrigger;
  sourceSnapshot: BookmarkNode;
  state: CaptureSessionState;
  plan?: CapturePlan;
  risk?: CaptureRiskAssessment;
  activities: CaptureActivity[];
  messages: CaptureMessage[];
  failure?: CaptureFailure;
  pageInformation?: 'sufficient' | 'insufficient';
  resolution?: CaptureResolution;
  stagingBatchId?: string;
  operationBatchId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  resolvedAt?: number;
  learningReview?: {
    reviewedAt: number;
    outcome: 'learned' | 'no-pattern';
    memoryIds: string[];
  };
}

export type CapturePreferenceKind = 'soft' | 'learned' | 'fixed-rule';

export interface CapturePreference {
  id: string;
  kind: CapturePreferenceKind;
  domain: string;
  urlPrefix?: string;
  titleIncludes?: string;
  action: 'prefer-folder' | 'avoid-folder';
  destinationFolderId?: string;
  destinationPath: string[];
  source:
    'allow' | 'reject' | 'agent-adjustment' | 'sleep-review' | 'explicit-rule';
  sourceSessionId: string;
  reviewSummary?: string;
  evidenceCount?: number;
  confidence?: Confidence;
  reviewedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CaptureLearningMemory extends CapturePreference {
  kind: 'learned';
  source: 'sleep-review';
  reviewSummary: string;
  evidenceCount: number;
  confidence: Confidence;
  reviewedAt: number;
}

export const pendingCaptureStates: readonly CaptureSessionState[] = [
  'analyzing',
  'ready',
  'pending',
  'adjusting',
  'executing',
  'failed'
];

export const endedCaptureStates: readonly CaptureSessionState[] = [
  'applied',
  'rejected',
  'ended',
  'expired',
  'undone'
];

export interface CapturePageContext {
  description?: string;
  text?: string;
  /** Ephemeral current-viewport image; session persistence must never include it. */
  imageDataUrl?: string;
}

export interface CaptureAgentBeginInput {
  bookmarkId: string;
  trigger: CaptureTrigger;
  page?: CapturePageContext;
}

export type CaptureAgentAction =
  | { type: 'allow' }
  | { type: 'reject' }
  | { type: 'message'; message: string }
  | { type: 'retry'; page?: CapturePageContext }
  | { type: 'end' }
  | { type: 'undo' };
