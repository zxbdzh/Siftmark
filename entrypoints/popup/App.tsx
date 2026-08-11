import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FolderTree,
  MessageSquareText,
  RotateCcw,
  RotateCw,
  Settings,
  ShieldAlert,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaptureSession } from '../../src/capture-agent';

interface CaptureActionResponse {
  success?: boolean;
  session?: CaptureSession;
  error?: string;
}

const activeStates = new Set<CaptureSession['state']>([
  'analyzing',
  'ready',
  'pending',
  'adjusting',
  'executing',
  'failed'
]);

export default function App() {
  const [sessions, setSessions] = useState<CaptureSession[]>([]);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const next = (await browser.runtime.sendMessage({
      type: 'capture-agent-list'
    })) as CaptureSession[];
    setSessions(Array.isArray(next) ? next : []);
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
    () => sessions.filter((session) => !activeStates.has(session.state)).slice(0, 6),
    [sessions]
  );

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
      if (response.session)
        setSessions((current) =>
          current.map((item) =>
            item.id === response.session!.id ? response.session! : item
          )
        );
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
          <span><Bot aria-hidden="true" /></span>
          <div>
            <strong className="brand-type">Siftmark</strong>
            <small>{pending.length ? `${pending.length} 项待处理` : '收藏队列已清空'}</small>
          </div>
        </div>
        <nav aria-label="扩展页面">
          <button type="button" title="书签管理器" aria-label="打开书签管理器" onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/manager.html') })}><FolderTree /></button>
          <button type="button" title="设置" aria-label="打开设置" onClick={() => void browser.runtime.openOptionsPage()}><Settings /></button>
        </nav>
      </header>

      {error ? <p className="popup-error" role="alert">{error}</p> : null}

      <section className="task-section" aria-labelledby="pending-title">
        <header className="section-heading">
          <h2 id="pending-title"><ShieldAlert aria-hidden="true" />待处理</h2>
          <span>{pending.length}</span>
        </header>
        {pending.length ? (
          <ul className="task-list">
            {pending.map((session) => (
              <li key={session.id} data-state={session.state}>
                <div className="task-copy">
                  <strong>{session.plan?.title || session.sourceSnapshot.title}</strong>
                  <Route session={session} />
                  {session.failure ? <small className="task-failure">{session.failure.message}</small> : <small>{taskStateLabel(session)}</small>}
                </div>
                <div className="task-actions">
                  {session.state === 'pending' || session.state === 'adjusting' ? (
                    <>
                      <button type="button" className="text-action" disabled={Boolean(busyId)} onClick={() => void act(session, 'reject')}><X />拒绝</button>
                      <button type="button" className="text-action" disabled={Boolean(busyId)} onClick={() => void act(session, 'adjust')}><MessageSquareText />调整</button>
                      <button type="button" className="primary-action" disabled={Boolean(busyId) || session.risk?.canExecute === false} onClick={() => void act(session, 'allow')}><Check />允许</button>
                    </>
                  ) : session.state === 'failed' ? (
                    <button type="button" className="primary-action" disabled={Boolean(busyId)} onClick={() => void act(session, 'retry')}><RotateCw />重试</button>
                  ) : (
                    <span className="working-indicator"><i />处理中</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">没有待确认的收藏</p>
        )}
      </section>

      <section className="task-section recent-section" aria-labelledby="recent-title">
        <header className="section-heading">
          <h2 id="recent-title"><Clock3 aria-hidden="true" />最近结果</h2>
        </header>
        {recent.length ? (
          <ul className="recent-list">
            {recent.map((session) => (
              <li key={session.id}>
                <button type="button" className="recent-main" onClick={() => session.sourceSnapshot.url && void browser.tabs.create({ url: session.sourceSnapshot.url })}>
                  <ResultIcon session={session} />
                  <span><strong>{session.plan?.title || session.sourceSnapshot.title}</strong><small>{resultLabel(session)}</small></span>
                </button>
                {session.state === 'applied' && session.operationBatchId ? (
                  <button type="button" className="icon-action" title="撤销" aria-label={`撤销 ${session.plan?.title || session.sourceSnapshot.title}`} disabled={Boolean(busyId)} onClick={() => void act(session, 'undo')}><RotateCcw /></button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="empty-state">还没有整理结果</p>}
      </section>
    </main>
  );
}

function Route({ session }: { session: CaptureSession }) {
  const parts = [
    ...(session.plan?.destination.path.map((folder) => folder.title) ?? []),
    ...(session.plan?.destination.newFolders ?? [])
  ];
  if (!parts.length) return null;
  return (
    <span className="task-route">
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
  return session.state === 'applied' ? <CheckCircle2 className="result-ok" /> : session.state === 'undone' ? <RotateCcw /> : <X className="result-muted" />;
}

function taskStateLabel(session: CaptureSession): string {
  if (session.state === 'pending') return '等待批准';
  if (session.state === 'adjusting') return '方案已调整';
  if (session.state === 'executing') return '正在执行';
  return '正在分析';
}

function resultLabel(session: CaptureSession): string {
  if (session.state === 'applied') return session.resolution === 'auto' ? '已自动整理' : '已批准';
  if (session.state === 'rejected') return '已拒绝，保留在收件箱';
  if (session.state === 'undone') return '已撤销';
  return '已过期';
}
