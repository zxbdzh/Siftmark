import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderInput,
  MessageSquareText,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CaptureActivity,
  CaptureSession,
  CaptureSessionHistoryRepository
} from '../../capture-agent';
import { endedCaptureStates } from '../../capture-agent';

const PAGE_SIZE = 20;

export function AgentHistorySection({
  repository
}: {
  repository: CaptureSessionHistoryRepository;
}) {
  const [page, setPage] = useState(0);
  const [sessions, setSessions] = useState<CaptureSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, count] = await Promise.all([
        repository.list(PAGE_SIZE, page * PAGE_SIZE),
        repository.count()
      ]);
      setSessions(rows);
      setTotal(count);
      if (page > 0 && rows.length === 0 && count > 0)
        setPage(Math.max(0, Math.ceil(count / PAGE_SIZE) - 1));
    } finally {
      setLoading(false);
    }
  }, [page, repository]);

  useEffect(() => {
    void load();
    const handleFocus = () => void load();
    const handleMessage = (event: unknown) => {
      if (
        (event as { type?: string }).type === 'capture-agent-sessions-changed'
      )
        void load();
    };
    window.addEventListener('focus', handleFocus);
    browser.runtime.onMessage.addListener(handleMessage);
    return () => {
      window.removeEventListener('focus', handleFocus);
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const range = useMemo(() => {
    if (!total) return '0 条';
    const first = page * PAGE_SIZE + 1;
    return `${first}-${Math.min(total, first + sessions.length - 1)} / ${total}`;
  }, [page, sessions.length, total]);

  const remove = async (session: CaptureSession) => {
    if (!endedCaptureStates.includes(session.state)) return;
    if (!window.confirm(`删除“${sessionTitle(session)}”的 Agent 记录？`))
      return;
    const removed = await repository.removeEnded(session.id);
    if (!removed) {
      setMessage('记录状态已变化，未执行删除');
      await load();
      return;
    }
    setMessage('记录已删除；已学习的归类偏好保持不变');
    void browser.runtime
      .sendMessage({ type: 'capture-agent-sessions-changed' })
      .catch(() => undefined);
    await load();
  };

  return (
    <section
      className="agent-history-section"
      id="agent"
      aria-labelledby="agent-history-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="agent-history-title">Agent 记录</h2>
          <p>每次收藏的对话、分析过程、目录方案与最终结果都保存在本机。</p>
        </div>
        <span className="agent-history-count">{total} 条</span>
      </div>

      <output className="agent-history-message" aria-live="polite">
        {message}
      </output>

      {loading && sessions.length === 0 ? (
        <div className="empty-state">正在读取 Agent 记录</div>
      ) : sessions.length > 0 ? (
        <div className="agent-record-list">
          {sessions.map((session) => (
            <AgentRecord
              key={session.id}
              session={session}
              onRemove={() => void remove(session)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          使用 Ctrl+D 收藏网页后，Agent 过程会显示在这里
        </div>
      )}

      {total > PAGE_SIZE ? (
        <nav className="agent-history-pagination" aria-label="Agent 记录分页">
          <button
            type="button"
            className="icon-button"
            title="上一页"
            aria-label="上一页"
            disabled={page === 0 || loading}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span>
            第 {page + 1} / {pages} 页 · {range}
          </span>
          <button
            type="button"
            className="icon-button"
            title="下一页"
            aria-label="下一页"
            disabled={page + 1 >= pages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function AgentRecord({
  session,
  onRemove
}: {
  session: CaptureSession;
  onRemove(): void;
}) {
  const title = sessionTitle(session);
  const canRemove = endedCaptureStates.includes(session.state);
  const route = routeText(session);

  return (
    <details className="agent-record" data-state={session.state}>
      <summary>
        <span className="agent-record-mark" aria-hidden="true">
          <Bot />
        </span>
        <span className="agent-record-summary">
          <strong>{title}</strong>
          <small>
            {stateLabel(session)} · {triggerLabel(session)} ·{' '}
            {formatDate(session.updatedAt)}
          </small>
        </span>
        <span className="agent-record-route" title={route || '书签栏'}>
          <FolderInput aria-hidden="true" />
          {route || '书签栏'}
        </span>
      </summary>

      <div className="agent-record-body">
        <dl className="agent-record-facts">
          <div>
            <dt>原网页</dt>
            <dd>{session.sourceSnapshot.url || '网址不可用'}</dd>
          </div>
          <div>
            <dt>目录建议</dt>
            <dd>{route || '书签栏'}</dd>
          </div>
          <div>
            <dt>新建目录</dt>
            <dd>{session.plan?.destination.newFolders.join(' / ') || '无'}</dd>
          </div>
          <div>
            <dt>最终结果</dt>
            <dd>{resultDetail(session)}</dd>
          </div>
          {session.plan?.memoryInfluence ? (
            <div>
              <dt>睡眠记忆</dt>
              <dd>{memoryInfluenceDetail(session)}</dd>
            </div>
          ) : null}
        </dl>

        {session.failure ? (
          <p className="agent-record-failure" role="note">
            {session.failure.message} · 已重试 {session.failure.retryCount} 次
          </p>
        ) : null}

        <RecordConversation session={session} />
        <RecordActivities activities={session.activities ?? []} />

        <footer className="agent-record-actions">
          {session.sourceSnapshot.url ? (
            <button
              type="button"
              onClick={() =>
                void browser.tabs.create({ url: session.sourceSnapshot.url })
              }
            >
              <ExternalLink aria-hidden="true" />
              打开网页
            </button>
          ) : null}
          {canRemove ? (
            <button
              type="button"
              className="danger-text-button"
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
              删除记录
            </button>
          ) : (
            <small>进行中或可重试的任务不能清理</small>
          )}
        </footer>
      </div>
    </details>
  );
}

function RecordConversation({ session }: { session: CaptureSession }) {
  return (
    <section className="agent-record-subsection" aria-label="对话记录">
      <h3>
        <MessageSquareText aria-hidden="true" />
        对话
      </h3>
      {session.messages.length > 0 ? (
        <ol className="agent-record-messages">
          {session.messages.map((message) => (
            <li key={message.id} data-role={message.role}>
              <span>{message.role === 'user' ? '你' : 'Agent'}</span>
              <p>{message.text}</p>
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {formatDate(message.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="agent-record-empty">本次无人工对话</p>
      )}
    </section>
  );
}

function RecordActivities({ activities }: { activities: CaptureActivity[] }) {
  return (
    <section className="agent-record-subsection" aria-label="分析过程">
      <h3>分析过程</h3>
      {activities.length > 0 ? (
        <ol className="agent-record-activities">
          {activities.map((activity) => (
            <li key={activity.id} data-status={activity.status}>
              <i aria-hidden="true" />
              <div>
                <strong>{activity.label}</strong>
                {activity.detail ? <p>{activity.detail}</p> : null}
                {activity.facts?.length ? (
                  <dl>
                    {activity.facts.map((fact) => (
                      <div key={`${activity.id}-${fact.label}`}>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
              <span>{activityStatusLabel(activity.status)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="agent-record-empty">旧记录没有保存分析过程</p>
      )}
    </section>
  );
}

function sessionTitle(session: CaptureSession): string {
  return session.plan?.title || session.sourceSnapshot.title || '未命名收藏';
}

function routeText(session: CaptureSession): string {
  return [
    ...(session.plan?.destination.path.map((folder) => folder.title) ?? []),
    ...(session.plan?.destination.newFolders ?? [])
  ].join(' / ');
}

function stateLabel(session: CaptureSession): string {
  if (session.state === 'applied')
    return session.resolution === 'auto' ? '自动归位' : '已批准';
  if (session.state === 'rejected') return '已拒绝';
  if (session.state === 'ended') return '已结束';
  if (session.state === 'expired') return '已过期';
  if (session.state === 'undone') return '已撤销';
  if (session.state === 'failed') return '可重试';
  if (session.state === 'pending' || session.state === 'adjusting')
    return '等待批准';
  if (session.state === 'executing') return '正在归位';
  return '正在分析';
}

function resultDetail(session: CaptureSession): string {
  if (session.state === 'ended') return '用户结束任务，书签保持原位';
  if (session.state === 'failed') return '整理失败，可继续对话或重试';
  if (session.state === 'rejected') return '用户拒绝方案，书签保持原位';
  if (session.state === 'expired') return '审批超时，书签保持原位';
  if (session.state === 'undone') return '整理操作已撤销';
  if (session.state === 'applied')
    return session.resolution === 'auto' ? '已自动归位' : '已按批准方案归位';
  return '任务尚未结束';
}

function memoryInfluenceDetail(session: CaptureSession): string {
  const influence = session.plan?.memoryInfluence;
  if (!influence) return '未命中';
  const adopted = new Set(influence.adoptedMemoryIds);
  const adoptedMatches = influence.matched.filter((memory) =>
    adopted.has(memory.id)
  );
  const visible = [
    ...adoptedMatches,
    ...influence.matched.filter((memory) => !adopted.has(memory.id))
  ].slice(0, Math.max(3, adoptedMatches.length));
  const detail = visible
    .map((memory) => {
      const target = memory.destinationPath.join(' / ') || '书签栏';
      const isAdopted = adopted.has(memory.id);
      const status =
        memory.action === 'avoid-folder'
          ? isAdopted
            ? '已避开'
            : '未避开'
          : isAdopted
            ? '已采用'
            : '未采用';
      return `${status} ${target}（${memory.evidenceCount} 个结果）`;
    })
    .join('；');
  const remaining = influence.matched.length - visible.length;
  return remaining > 0 ? `${detail}；其余 ${remaining} 条未展开` : detail;
}

function triggerLabel(session: CaptureSession): string {
  if (session.trigger === 'native-bookmark') return 'Ctrl+D';
  if (session.trigger === 'keyboard-command') return '快捷键';
  if (session.trigger === 'context-menu') return '右键菜单';
  return '插件菜单';
}

function activityStatusLabel(status: CaptureActivity['status']): string {
  if (status === 'completed') return '完成';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '跳过';
  return '进行中';
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
