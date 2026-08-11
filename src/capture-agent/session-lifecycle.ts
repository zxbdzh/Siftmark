import type { BookmarkNode } from '../bookmarks/types';
import {
  CAPTURE_SESSION_TTL_MS,
  pendingCaptureStates,
  type CaptureFailure,
  type CapturePlan,
  type CaptureRiskAssessment,
  type CaptureSession,
  type CaptureTrigger
} from './types';

export interface NewCaptureSessionInput {
  id: string;
  bookmark: BookmarkNode;
  trigger: CaptureTrigger;
  now: number;
}

export function createCaptureSession(
  input: NewCaptureSessionInput
): CaptureSession {
  return {
    id: input.id,
    bookmarkId: input.bookmark.id,
    trigger: input.trigger,
    sourceSnapshot: input.bookmark,
    state: 'analyzing',
    activities: [],
    messages: [],
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: input.now + CAPTURE_SESSION_TTL_MS
  };
}

export function attachCapturePlan(
  session: CaptureSession,
  plan: CapturePlan,
  risk: CaptureRiskAssessment,
  now: number
): CaptureSession {
  assertPending(session);
  return {
    ...session,
    state: risk.decision === 'auto' ? 'ready' : 'pending',
    plan,
    risk,
    failure: undefined,
    updatedAt: now
  };
}

export function failCaptureSession(
  session: CaptureSession,
  failure: CaptureFailure,
  now: number
): CaptureSession {
  assertPending(session);
  return {
    ...session,
    state: 'failed',
    failure,
    updatedAt: now
  };
}

export function canRetryCapture(failure: CaptureFailure): boolean {
  return (
    failure.retryable && failure.kind === 'network' && failure.retryCount < 2
  );
}

function assertPending(session: CaptureSession): void {
  if (!pendingCaptureStates.includes(session.state))
    throw new Error(`Capture session is already resolved: ${session.id}`);
}
