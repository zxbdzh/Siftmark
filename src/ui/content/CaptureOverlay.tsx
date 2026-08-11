import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Folder,
  FolderPlus,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  RotateCw,
  X,
  XCircle
} from 'lucide-react';
import type { CaptureActivity } from '../../capture-agent/types';

export type CaptureOverlayPhase =
  'processing' | 'approval' | 'saved' | 'rejected' | 'error';

export type CaptureOverlayAction =
  'allow' | 'reject' | 'adjust' | 'undo' | 'retry';

export interface CaptureOverlayView {
  sessionId?: string;
  phase: CaptureOverlayPhase;
  title?: string;
  destinationPath?: string[];
  newFolderName?: string;
  message?: string;
  activities?: CaptureActivity[];
  canAdjust?: boolean;
  canUndo?: boolean;
}

interface CaptureOverlayProps {
  view: CaptureOverlayView;
  busyAction?: CaptureOverlayAction;
  onAction: (action: CaptureOverlayAction) => void;
  onDismiss: () => void;
}

const phaseCopy: Record<
  CaptureOverlayPhase,
  { eyebrow: string; heading: string }
> = {
  processing: { eyebrow: 'AI 整理中', heading: '正在判断收藏位置' },
  approval: { eyebrow: '需要确认', heading: '批准这次整理吗？' },
  saved: { eyebrow: '已自动整理', heading: '收藏已放好' },
  rejected: { eyebrow: '已拒绝', heading: '收藏保留在收件箱' },
  error: { eyebrow: '整理未完成', heading: '收藏已保留原位' }
};

function FolderRoute({ path = [] }: { path?: string[] }) {
  const visiblePath = path.length > 0 ? path : ['书签栏'];
  return (
    <ol className="siftmark-route" aria-label="收藏位置">
      {visiblePath.map((segment, index) => (
        <li key={`${segment}-${index}`}>
          {index > 0 ? <ChevronRight aria-hidden="true" /> : null}
          <span className="siftmark-route-node">
            <Folder aria-hidden="true" />
            {segment}
          </span>
        </li>
      ))}
    </ol>
  );
}

function IconButton({
  label,
  onClick
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="siftmark-icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <X aria-hidden="true" />
    </button>
  );
}

function ActivityIcon({ status }: { status: CaptureActivity['status'] }) {
  if (status === 'completed') return <CheckCircle2 aria-hidden="true" />;
  if (status === 'failed') return <XCircle aria-hidden="true" />;
  if (status === 'running')
    return (
      <LoaderCircle className="siftmark-activity-spinner" aria-hidden="true" />
    );
  return <CircleDashed aria-hidden="true" />;
}

function ProcessingTrace({
  activities = []
}: {
  activities?: CaptureActivity[];
}) {
  if (activities.length === 0) return null;
  const visibleActivities =
    activities.length <= 4
      ? activities
      : [activities[0]!, ...activities.slice(-3)];
  return (
    <div className="siftmark-processing-trace">
      <div className="siftmark-trace-heading">
        <span>分析过程</span>
        <span>
          {activities.length} / {activities.length}
        </span>
      </div>
      <ol aria-label="分析过程">
        {visibleActivities.map((activity) => (
          <li key={activity.id} data-status={activity.status}>
            <span className="siftmark-activity-icon">
              <ActivityIcon status={activity.status} />
            </span>
            <span className="siftmark-activity-copy">
              <strong>{activity.label}</strong>
              {activity.detail ? <small>{activity.detail}</small> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CaptureOverlay({
  view,
  busyAction,
  onAction,
  onDismiss
}: CaptureOverlayProps) {
  const copy = phaseCopy[view.phase];
  const isApproval = view.phase === 'approval';
  const hasRoute = Boolean(view.destinationPath?.length || view.newFolderName);

  return (
    <section
      className="siftmark-capture-overlay"
      data-phase={view.phase}
      role={isApproval ? 'dialog' : view.phase === 'error' ? 'alert' : 'status'}
      aria-live={
        isApproval ? 'off' : view.phase === 'error' ? 'assertive' : 'polite'
      }
      aria-labelledby="siftmark-overlay-heading"
    >
      <header className="siftmark-overlay-header">
        <div className="siftmark-agent-mark" aria-hidden="true">
          <Bot />
        </div>
        <div className="siftmark-overlay-heading-group">
          <span className="siftmark-overlay-eyebrow">{copy.eyebrow}</span>
          <h2 id="siftmark-overlay-heading">{copy.heading}</h2>
        </div>
        <IconButton label="隐藏提示" onClick={onDismiss} />
      </header>

      {view.phase === 'processing' ? (
        <>
          <div className="siftmark-processing-line" aria-hidden="true">
            <span />
          </div>
          <ProcessingTrace activities={view.activities} />
        </>
      ) : null}

      {hasRoute ? (
        <div className="siftmark-overlay-field">
          <span className="siftmark-field-label">收藏到</span>
          <FolderRoute path={view.destinationPath} />
        </div>
      ) : null}

      {view.newFolderName ? (
        <div className="siftmark-overlay-field">
          <span className="siftmark-field-label">新建目录</span>
          <span className="siftmark-route-node siftmark-route-new">
            <FolderPlus aria-hidden="true" />
            {view.newFolderName}
          </span>
        </div>
      ) : null}

      {view.title ? (
        <div className="siftmark-overlay-field siftmark-title-field">
          <span className="siftmark-field-label">标题</span>
          <span className="siftmark-title-value">{view.title}</span>
        </div>
      ) : null}

      {view.message ? (
        <p className="siftmark-overlay-message">{view.message}</p>
      ) : null}

      {isApproval ? (
        <div className="siftmark-overlay-actions">
          <button
            type="button"
            className="siftmark-button siftmark-button-secondary"
            disabled={Boolean(busyAction)}
            onClick={() => onAction('reject')}
          >
            <X aria-hidden="true" />
            {busyAction === 'reject' ? '正在拒绝' : '拒绝'}
          </button>
          <button
            type="button"
            className="siftmark-button siftmark-button-secondary siftmark-adjust-button"
            disabled={Boolean(busyAction)}
            onClick={() => onAction('adjust')}
          >
            <MessageSquareText aria-hidden="true" />与 Agent 调整
          </button>
          <button
            type="button"
            className="siftmark-button siftmark-button-primary"
            disabled={Boolean(busyAction)}
            onClick={() => onAction('allow')}
          >
            <Check aria-hidden="true" />
            {busyAction === 'allow' ? '正在执行' : '允许'}
          </button>
        </div>
      ) : null}

      {view.phase === 'saved' && (view.canUndo || view.canAdjust) ? (
        <div className="siftmark-overlay-actions siftmark-result-actions">
          {view.canUndo ? (
            <button
              type="button"
              className="siftmark-button siftmark-button-secondary"
              disabled={Boolean(busyAction)}
              onClick={() => onAction('undo')}
            >
              <RotateCcw aria-hidden="true" />
              {busyAction === 'undo' ? '正在撤销' : '撤销'}
            </button>
          ) : null}
          {view.canAdjust ? (
            <button
              type="button"
              className="siftmark-button siftmark-button-secondary"
              disabled={Boolean(busyAction)}
              onClick={() => onAction('adjust')}
            >
              <MessageSquareText aria-hidden="true" />
              调整
            </button>
          ) : null}
        </div>
      ) : null}

      {view.phase === 'error' ? (
        <div className="siftmark-overlay-actions siftmark-result-actions">
          <button
            type="button"
            className="siftmark-button siftmark-button-primary"
            disabled={Boolean(busyAction)}
            onClick={() => onAction('retry')}
          >
            <RotateCw aria-hidden="true" />
            {busyAction === 'retry' ? '正在重试' : '重试'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
