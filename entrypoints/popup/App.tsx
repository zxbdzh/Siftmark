import {
  ArrowUpRight,
  BookmarkCheck,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  FolderInput,
  FolderTree,
  History,
  Inbox,
  MessageSquareText,
  RotateCcw,
  RotateCw,
  Settings,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureSession } from '../../src/capture-agent';

interface CaptureActionResponse {
  success?: boolean;
  session?: CaptureSession;
  error?: string;
}

type PopupView = 'queue' | 'receipts';
type LaneStepState = 'idle' | 'current' | 'done' | 'error';

interface LaneView {
  stage: 'idle' | 'analysis' | 'approval' | 'placing' | 'done' | 'failed';
  title: string;
  detail: string;
  finalLabel: string;
  steps: [LaneStepState, LaneStepState, LaneStepState];
}

const activeStates = new Set<CaptureSession['state']>([
  'analyzing',
  'ready',
  'pending',
  'adjusting',
  'executing',
  'failed'
]);

const decisionStates = new Set<CaptureSession['state']>([
  'pending',
  'adjusting'
]);

export default function App() {
  const [sessions, setSessions] = useState<CaptureSession[]>([]);
  const [activeView, setActiveView] = useState<PopupView>('queue');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const initializedView = useRef(false);

  const refresh = useCallback(async () => {
    const response = (await browser.runtime.sendMessage({
      type: 'capture-agent-list'
    })) as CaptureSession[];
    const next = Array.isArray(response) ? response : [];
    setSessions(next);

    if (!initializedView.current) {
      const hasActive = next.some((session) => activeStates.has(session.state));
      const hasReceipt = next.some(
        (session) => !activeStates.has(session.state)
      );
      setActiveView(hasActive || !hasReceipt ? 'queue' : 'receipts');
      initializedView.current = true;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener = (event: unknown) => {
      if (
        (event as { type?: string }).type === 'capture-agent-sessions-changed'
      )
        void refresh();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const pending = useMemo(
    () => sessions.filter((session) => activeStates.has(session.state)),
    [sessions]
  );
  const recent = useMemo(
    () =>
      sessions
        .filter((session) => !activeStates.has(session.state))
        .slice(0, 8),
    [sessions]
  );
  const approvalCount = pending.filter((session) =>
    decisionStates.has(session.state)
  ).length;
  const failedCount = pending.filter(
    (session) => session.state === 'failed'
  ).length;
  const processingCount = pending.length - approvalCount - failedCount;
  const lane = laneFromSession(pending[0] ?? recent[0]);
  const status = failedCount
    ? { tone: 'failed', label: `${failedCount} 项异常` }
    : approvalCount
      ? { tone: 'approval', label: `${approvalCount} 项待决定` }
      : processingCount
        ? { tone: 'processing', label: '正在整理' }
        : { tone: 'ready', label: 'Agent 就绪' };

  const act = async (
    session: CaptureSession,
    action: 'allow' | 'reject' | 'adjust' | 'undo' | 'retry'
  ) => {
    if (busyId) return;
    setBusyId(session.id);
    setError('');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'capture-agent-action',
        input: { sessionId: session.id, action }
      })) as CaptureActionResponse;
      if (!response?.success) throw new Error(response?.error || '操作未完成');
      if (response.session) {
        setSessions((current) =>
          current.map((item) =>
            item.id === response.session!.id ? response.session! : item
          )
        );
        if ((action === 'allow' || action === 'reject') && pending.length === 1)
          setActiveView('receipts');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作未完成');
    } finally {
      setBusyId('');
    }
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="popup-brand">
          <span className="popup-agent-mark">
            <Bot aria-hidden="true" />
          </span>
          <div>
            <strong className="brand-type">Siftmark</strong>
            <small>收藏 Agent</small>
          </div>
        </div>
        <div className="popup-header-tools">
          <span className="agent-status" data-tone={status.tone}>
            <i aria-hidden="true" />
            {status.label}
          </span>
          <button
            type="button"
            title="设置"
            aria-label="打开设置"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>

      {error ? (
        <p className="popup-error" role="alert">
          {error}
        </p>
      ) : null}

      <section
        className="capture-lane"
        data-stage={lane.stage}
        aria-labelledby="capture-lane-title"
      >
        <div className="lane-summary">
          <span>当前通道</span>
          <strong id="capture-lane-title">{lane.title}</strong>
          <small title={lane.detail}>{lane.detail}</small>
        </div>
        <ol aria-label="收藏处理进度">
          <LaneStep
            icon={<BookmarkCheck />}
            label="已保存"
            state={lane.steps[0]}
          />
          <LaneStep icon={<Sparkles />} label="AI 整理" state={lane.steps[1]} />
          <LaneStep
            icon={<ShieldCheck />}
            label={lane.finalLabel}
            state={lane.steps[2]}
          />
        </ol>
      </section>

      <div className="popup-view-tabs" role="tablist" aria-label="收藏视图">
        <button
          type="button"
          role="tab"
          id="queue-tab"
          aria-controls="queue-panel"
          aria-selected={activeView === 'queue'}
          onClick={() => setActiveView('queue')}
        >
          <Inbox aria-hidden="true" />
          任务
          <span>{pending.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="receipts-tab"
          aria-controls="receipts-panel"
          aria-selected={activeView === 'receipts'}
          onClick={() => setActiveView('receipts')}
        >
          <History aria-hidden="true" />
          回执
          <span>{recent.length}</span>
        </button>
      </div>

      <section
        className="popup-panel queue-panel"
        id="queue-panel"
        role="tabpanel"
        aria-labelledby="queue-tab"
        hidden={activeView !== 'queue'}
      >
        {pending.length ? (
          <ul className="task-list" aria-label="收藏任务">
            {pending.map((session) => {
              const needsDecision = decisionStates.has(session.state);
              const completed = session.activities.filter((activity) =>
                ['completed', 'skipped'].includes(activity.status)
              ).length;
              return (
                <li key={session.id} data-state={session.state}>
                  <header className="task-meta">
                    <span className="task-state">
                      <i aria-hidden="true" />
                      {taskStateLabel(session)}
                    </span>
                    {needsDecision ? (
                      <button
                        type="button"
                        className="adjust-action"
                        disabled={Boolean(busyId)}
                        onClick={() => void act(session, 'adjust')}
                      >
                        <MessageSquareText aria-hidden="true" />
                        调整方案
                      </button>
                    ) : null}
                  </header>
                  <div className="task-copy">
                    <h3>
                      {session.plan?.title || session.sourceSnapshot.title}
                    </h3>
                    <Route session={session} />
                    {session.failure ? (
                      <small className="task-failure">
                        {session.failure.message}
                      </small>
                    ) : needsDecision && session.plan?.reason ? (
                      <small>{session.plan.reason}</small>
                    ) : (
                      <small>
                        已完成 {completed} / {session.activities.length} 个步骤
                      </small>
                    )}
                  </div>
                  <div className="task-actions">
                    {needsDecision ? (
                      <>
                        <button
                          type="button"
                          className="reject-action"
                          aria-busy={busyId === session.id}
                          disabled={Boolean(busyId)}
                          onClick={() => void act(session, 'reject')}
                        >
                          <X aria-hidden="true" />
                          拒绝
                        </button>
                        <button
                          type="button"
                          className="primary-action"
                          aria-busy={busyId === session.id}
                          disabled={
                            Boolean(busyId) ||
                            session.risk?.canExecute === false
                          }
                          onClick={() => void act(session, 'allow')}
                        >
                          <Check aria-hidden="true" />
                          允许
                        </button>
                      </>
                    ) : session.state === 'failed' ? (
                      <button
                        type="button"
                        className="primary-action retry-action"
                        aria-busy={busyId === session.id}
                        disabled={Boolean(busyId)}
                        onClick={() => void act(session, 'retry')}
                      >
                        <RotateCw aria-hidden="true" />
                        重试整理
                      </button>
                    ) : (
                      <span className="working-indicator">
                        <i aria-hidden="true" />
                        处理中
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty-state">
            <CheckCircle2 aria-hidden="true" />
            <strong>无需处理</strong>
            <span>没有待确认的收藏</span>
          </div>
        )}
      </section>

      <section
        className="popup-panel receipts-panel"
        id="receipts-panel"
        role="tabpanel"
        aria-labelledby="receipts-tab"
        hidden={activeView !== 'receipts'}
      >
        {recent.length ? (
          <ul className="recent-list" aria-label="整理回执">
            {recent.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="recent-main"
                  onClick={() =>
                    session.sourceSnapshot.url &&
                    void browser.tabs.create({
                      url: session.sourceSnapshot.url
                    })
                  }
                >
                  <ResultIcon session={session} />
                  <span className="receipt-copy">
                    <strong>
                      {session.plan?.title || session.sourceSnapshot.title}
                    </strong>
                    <small>{routeText(session) || resultLabel(session)}</small>
                  </span>
                  <span className="receipt-meta">
                    <small>{resultLabel(session)}</small>
                    <time dateTime={new Date(session.updatedAt).toISOString()}>
                      {relativeTime(session.updatedAt)}
                    </time>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
                {session.state === 'applied' && session.operationBatchId ? (
                  <button
                    type="button"
                    className="icon-action"
                    title="撤销"
                    aria-label={`撤销 ${session.plan?.title || session.sourceSnapshot.title}`}
                    disabled={Boolean(busyId)}
                    onClick={() => void act(session, 'undo')}
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <History aria-hidden="true" />
            <strong>还没有整理结果</strong>
          </div>
        )}
      </section>

      <footer className="popup-footer">
        <button
          type="button"
          onClick={() =>
            void browser.tabs.create({
              url: browser.runtime.getURL('/manager.html')
            })
          }
        >
          <FolderTree aria-hidden="true" />
          打开书签树
          <ArrowUpRight aria-hidden="true" />
        </button>
      </footer>
    </main>
  );
}

function LaneStep({
  icon,
  label,
  state
}: {
  icon: React.ReactNode;
  label: string;
  state: LaneStepState;
}) {
  return (
    <li
      data-state={state}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <span>{icon}</span>
      <small>{label}</small>
    </li>
  );
}

function Route({ session }: { session: CaptureSession }) {
  const parts = routeParts(session);
  if (!parts.length) return null;
  return (
    <span className="task-route">
      <FolderInput aria-hidden="true" />
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? <ChevronRight aria-hidden="true" /> : null}
          {part}
        </span>
      ))}
    </span>
  );
}

function ResultIcon({ session }: { session: CaptureSession }) {
  return session.state === 'applied' ? (
    <CheckCircle2 className="result-ok" />
  ) : session.state === 'undone' ? (
    <RotateCcw />
  ) : (
    <X className="result-muted" />
  );
}

function laneFromSession(session?: CaptureSession): LaneView {
  if (!session)
    return {
      stage: 'idle',
      title: '等待下一次收藏',
      detail: '当前队列为空',
      finalLabel: '归位',
      steps: ['idle', 'idle', 'idle']
    };

  const detail = session.plan?.title || session.sourceSnapshot.title;
  if (session.state === 'analyzing' || session.state === 'ready')
    return {
      stage: 'analysis',
      title: '正在判断收藏位置',
      detail,
      finalLabel: '归位',
      steps: ['done', 'current', 'idle']
    };
  if (decisionStates.has(session.state))
    return {
      stage: 'approval',
      title: '需要你的决定',
      detail,
      finalLabel: '待批准',
      steps: ['done', 'done', 'current']
    };
  if (session.state === 'executing')
    return {
      stage: 'placing',
      title: '正在放入目标目录',
      detail,
      finalLabel: '归位中',
      steps: ['done', 'done', 'current']
    };
  if (session.state === 'failed')
    return {
      stage: 'failed',
      title: '整理未完成',
      detail: session.failure?.message || detail,
      finalLabel: '待处理',
      steps: ['done', 'error', 'idle']
    };
  if (session.state === 'applied')
    return {
      stage: 'done',
      title: '最近收藏已归位',
      detail: routeText(session) || detail,
      finalLabel: '已归位',
      steps: ['done', 'done', 'done']
    };
  if (session.state === 'undone')
    return {
      stage: 'done',
      title: '最近操作已撤销',
      detail,
      finalLabel: '已撤销',
      steps: ['done', 'done', 'done']
    };
  return {
    stage: 'done',
    title: session.state === 'expired' ? '最近任务已过期' : '最近收藏已保留',
    detail,
    finalLabel: session.state === 'expired' ? '已过期' : '已保留',
    steps: ['done', 'done', 'done']
  };
}

function taskStateLabel(session: CaptureSession): string {
  if (session.state === 'pending') return '等待批准';
  if (session.state === 'adjusting') return '方案已调整';
  if (session.state === 'executing') return '正在归位';
  if (session.state === 'failed') return '整理异常';
  return '正在分析';
}

function resultLabel(session: CaptureSession): string {
  if (session.state === 'applied')
    return session.resolution === 'auto' ? '自动归位' : '已批准';
  if (session.state === 'rejected') return '已拒绝';
  if (session.state === 'undone') return '已撤销';
  return '已过期';
}

function routeParts(session: CaptureSession): string[] {
  return [
    ...(session.plan?.destination.path.map((folder) => folder.title) ?? []),
    ...(session.plan?.destination.newFolders ?? [])
  ];
}

function routeText(session: CaptureSession): string {
  return routeParts(session).join(' / ');
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (elapsedMinutes < 1) return '刚刚';
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} 小时前`;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric'
  }).format(timestamp);
}
