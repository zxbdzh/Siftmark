import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { extractPageCapture } from '../src/capture/extract-page';
import type { CaptureSession } from '../src/capture-agent/types';
import {
  CaptureOverlay,
  type CaptureOverlayAction,
  type CaptureOverlayPhase,
  type CaptureOverlayView
} from '../src/ui/content/CaptureOverlay';
import { captureOverlayStyles } from '../src/ui/content/capture-overlay.css';

const HIDE_AFTER_MS: Partial<Record<CaptureOverlayPhase, number>> = {
  approval: 18_000,
  saved: 8_000,
  rejected: 8_000,
  error: 12_000
};

interface CaptureAgentOverlayMessage {
  type?: string;
  view?: CaptureOverlayView;
  session?: CaptureOverlayView | CaptureSession;
  status?: CaptureOverlayPhase | 'success';
  sessionId?: string;
  title?: string;
  destinationPath?: string[];
  newFolderNames?: string[];
  newFolderName?: string;
  detail?: string;
  canAdjust?: boolean;
  canUndo?: boolean;
}

interface CaptureAgentActionResponse {
  success?: boolean;
  view?: CaptureOverlayView;
  session?: CaptureOverlayView | CaptureSession;
  error?: string;
}

function viewFromSession(session: CaptureSession): CaptureOverlayView {
  const phaseByState: Record<CaptureSession['state'], CaptureOverlayPhase> = {
    analyzing: 'processing',
    ready: 'processing',
    pending: 'approval',
    adjusting: 'approval',
    executing: 'processing',
    applied: 'saved',
    rejected: 'rejected',
    failed: 'error',
    expired: 'rejected',
    undone: 'rejected'
  };
  const phase = phaseByState[session.state];
  return {
    sessionId: session.id,
    phase,
    title: session.plan?.title,
    destinationPath: session.plan?.destination.path.map(({ title }) => title),
    newFolderNames: session.plan?.destination.newFolders,
    message: session.failure?.message,
    activities: session.activities,
    canAdjust: phase === 'approval' || phase === 'saved',
    canUndo: phase === 'saved' && Boolean(session.operationBatchId)
  };
}

function isCaptureSession(
  value: CaptureOverlayView | CaptureSession
): value is CaptureSession {
  return 'state' in value && 'bookmarkId' in value;
}

function readOverlayView(message: unknown): CaptureOverlayView | undefined {
  const value = message as CaptureAgentOverlayMessage;
  if (
    value.type !== 'capture-agent-overlay' &&
    value.type !== 'capture-agent-session-changed' &&
    value.type !== 'native-smart-bookmark-status'
  )
    return undefined;

  if (value.view?.phase) return value.view;
  if (value.session)
    return isCaptureSession(value.session)
      ? viewFromSession(value.session)
      : value.session;
  if (!value.status) return undefined;

  const phase = value.status === 'success' ? 'saved' : value.status;
  return {
    phase,
    sessionId: value.sessionId,
    title: value.title,
    destinationPath: value.destinationPath,
    newFolderNames:
      value.newFolderNames ??
      (value.newFolderName ? [value.newFolderName] : undefined),
    message: value.detail,
    canAdjust:
      value.canAdjust ?? (phase === 'saved' && Boolean(value.sessionId)),
    canUndo: value.canUndo ?? (phase === 'saved' && Boolean(value.sessionId))
  };
}

export function ContentEntry() {
  const [view, setView] = useState<CaptureOverlayView>();
  const [busyAction, setBusyAction] = useState<CaptureOverlayAction>();
  const hideTimer = useRef<ReturnType<typeof globalThis.setTimeout>>();

  const dismiss = useCallback(() => {
    if (hideTimer.current) globalThis.clearTimeout(hideTimer.current);
    setView(undefined);
    setBusyAction(undefined);
  }, []);

  useEffect(() => {
    const listener = (message: unknown) => {
      const nextView = readOverlayView(message);
      if (!nextView) return;
      setBusyAction(undefined);
      setView(nextView);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (hideTimer.current) globalThis.clearTimeout(hideTimer.current);
    if (!view) return;
    const delay = HIDE_AFTER_MS[view.phase];
    if (delay)
      hideTimer.current = globalThis.setTimeout(() => {
        setView(undefined);
        setBusyAction(undefined);
      }, delay);
    return () => {
      if (hideTimer.current) globalThis.clearTimeout(hideTimer.current);
    };
  }, [view]);

  useEffect(() => {
    if (!view) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [dismiss, view]);

  const act = async (action: CaptureOverlayAction) => {
    if (!view || busyAction) return;
    setBusyAction(action);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'capture-agent-action',
        input: {
          action,
          sessionId: view.sessionId
        }
      })) as CaptureAgentActionResponse | undefined;
      const responseView = response?.view ?? response?.session;
      const nextView = responseView
        ? isCaptureSession(responseView)
          ? viewFromSession(responseView)
          : responseView
        : undefined;
      if (nextView?.phase) setView(nextView);
      else if (response?.success === false)
        setView({
          ...view,
          phase: 'error',
          message: response.error || '操作未完成，请重试。'
        });
      else if (action === 'adjust' || action === 'reject') dismiss();
    } catch (error) {
      setView({
        ...view,
        phase: 'error',
        message: error instanceof Error ? error.message : '操作未完成，请重试。'
      });
    } finally {
      setBusyAction(undefined);
    }
  };

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('style', null, captureOverlayStyles),
    view
      ? React.createElement(CaptureOverlay, {
          view,
          busyAction,
          onAction: (action) => void act(action),
          onDismiss: dismiss
        })
      : null
  );
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const value = message as { type?: string; blockedDomains?: string[] };
      if (value.type === 'capture-page')
        return Promise.resolve(
          extractPageCapture(document, location, value.blockedDomains ?? [])
        );
    });

    const host = document.createElement('div');
    host.id = 'siftmark-root';
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.append(mount);
    createRoot(mount).render(React.createElement(ContentEntry));
  }
});
