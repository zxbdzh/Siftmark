import { describe, expect, it } from 'vitest';
import {
  CAPTURE_SESSION_TTL_MS,
  attachCapturePlan,
  canRetryCapture,
  createCaptureSession,
  failCaptureSession,
  type CapturePlan
} from '../../../src/capture-agent';

const bookmark = {
  id: 'bookmark',
  parentId: 'inbox',
  index: 0,
  title: 'Agent docs',
  url: 'https://example.test/docs'
};

describe('capture session lifecycle', () => {
  it('starts after the native bookmark already exists', () => {
    expect(
      createCaptureSession({
        id: 'session',
        bookmark,
        trigger: 'native-bookmark',
        now: 10
      })
    ).toMatchObject({
      id: 'session',
      bookmarkId: 'bookmark',
      sourceSnapshot: bookmark,
      state: 'analyzing',
      expiresAt: 10 + CAPTURE_SESSION_TTL_MS
    });
  });

  it('routes safe plans to the execution-ready state and risks to approval', () => {
    const initial = createCaptureSession({
      id: 'session',
      bookmark,
      trigger: 'native-bookmark',
      now: 1
    });
    expect(
      attachCapturePlan(
        initial,
        plan,
        { decision: 'auto', reasons: [], canExecute: true },
        2
      ).state
    ).toBe('ready');
    expect(
      attachCapturePlan(
        initial,
        plan,
        {
          decision: 'approval',
          reasons: ['new-folder'],
          canExecute: true
        },
        2
      ).state
    ).toBe('pending');
  });

  it('automatically retries only transient network failures twice', () => {
    expect(
      canRetryCapture({
        kind: 'network',
        message: 'offline',
        retryable: true,
        retryCount: 1
      })
    ).toBe(true);
    expect(
      canRetryCapture({
        kind: 'network',
        message: 'offline',
        retryable: true,
        retryCount: 2
      })
    ).toBe(false);
    expect(
      canRetryCapture({
        kind: 'schema',
        message: 'invalid response',
        retryable: true,
        retryCount: 0
      })
    ).toBe(false);
  });

  it('preserves the source bookmark when analysis fails', () => {
    const initial = createCaptureSession({
      id: 'session',
      bookmark,
      trigger: 'native-bookmark',
      now: 1
    });
    expect(
      failCaptureSession(
        initial,
        {
          kind: 'configuration',
          message: 'missing model',
          retryable: false,
          retryCount: 0
        },
        2
      )
    ).toMatchObject({ state: 'failed', sourceSnapshot: bookmark });
  });
});

const plan: CapturePlan = {
  destination: {
    folderId: 'agent',
    path: [{ id: 'agent', title: 'Agent' }],
    newFolders: []
  },
  title: 'Agent docs',
  tags: [],
  summary: '',
  confidence: 'high',
  reason: 'matching folder',
  relatedBookmarks: [],
  generatedAt: 2
};
