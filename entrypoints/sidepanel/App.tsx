import {
  AlertTriangle,
  ArrowDown,
  Bookmark,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Folder,
  FolderPlus,
  Globe2,
  LoaderCircle,
  ListTree,
  MessageCircle,
  RotateCcw,
  RotateCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  X,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CaptureActivity,
  CapturePlan,
  CaptureRiskReason,
  CaptureSession
} from '../../src/capture-agent';
import { BrandMark } from '../../src/ui/components/BrandMark';

interface CaptureActionResponse {
  success?: boolean;
  session?: CaptureSession;
  error?: string;
}

type AgentAction = 'allow' | 'reject' | 'undo' | 'retry' | 'end' | 'message';
type AgentView = 'conversation' | 'process';
type LoadState = 'loading' | 'ready' | 'empty' | 'error';

interface PendingMessage {
  sessionId: string;
  text: string;
  startedAt: number;
}

interface QuickAdjustment {
  label: string;
  message: string;
}

const riskLabels: Record<CaptureRiskReason, string> = {
  'new-folder': '将新建目录',
  'multi-level-folder-creation': '涉及多级目录',
  'unclear-destination': '目标目录不明确',
  'low-confidence': '判断置信度不足',
  'exact-duplicate': '发现相同网址',
  'similar-bookmark': '发现相似收藏',
  'rule-conflict': '与本地规则冲突',
  'large-title-change': '标题变化较大',
  'special-folder': '目标是特殊目录',
  'insufficient-page-information': '页面信息不足',
  'stale-state': '书签状态已变化'
};

const activityKindLabels: Record<CaptureActivity['kind'], string> = {
  capture: '收藏',
  page: '页面读取',
  folders: '目录比较',
  model: 'AI 分析',
  vision: '识图',
  'web-search': '联网搜索',
  risk: '风险检查',
  execution: '本地执行'
};

function ActivityStatusIcon() {
  return (
    <>
      <CheckCircle2 data-glyph="completed" aria-hidden="true" />
      <XCircle data-glyph="failed" aria-hidden="true" />
      <LoaderCircle
        className="trace-spinner"
        data-glyph="running"
        aria-hidden="true"
      />
      <CircleDashed data-glyph="pending-skipped" aria-hidden="true" />
    </>
  );
}

function AnalysisTrace({ activities }: { activities: CaptureActivity[] }) {
  const completed = activities.filter((activity) =>
    ['completed', 'skipped'].includes(activity.status)
  ).length;
  return (
    <section className="analysis-trace" aria-labelledby="analysis-trace-title">
      <header>
        <div>
          <Sparkles aria-hidden="true" />
          <h2 id="analysis-trace-title">分析过程</h2>
        </div>
        <span>
          {completed} / {activities.length} 完成
        </span>
      </header>

      {activities.length ? (
        <ol aria-live="polite">
          {activities.map((activity) => (
            <li key={activity.id} data-status={activity.status}>
              <span className="trace-status-icon">
                <ActivityStatusIcon />
              </span>
              <div className="trace-copy">
                <div className="trace-step-meta">
                  <span className="trace-kind">
                    {activityKindLabels[activity.kind]}
                  </span>
                  {activity.durationMs !== undefined ? (
                    <span>{formatDuration(activity.durationMs)}</span>
                  ) : null}
                </div>
                <strong>{activity.label}</strong>
                {activity.detail ? <p>{activity.detail}</p> : null}
                {activity.facts?.length ? (
                  <dl className="trace-facts">
                    {activity.facts.map((fact, index) => (
                      <div key={`${fact.label}-${index}`}>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="trace-empty">这个旧任务没有保存分析记录。</p>
      )}

      <p className="trace-privacy">
        <ShieldCheck aria-hidden="true" />
        展示操作记录与判断摘要，不包含模型的私密思维链。
      </p>
    </section>
  );
}

function PlanInsights({ plan }: { plan: CapturePlan }) {
  return (
    <section className="plan-insights" aria-labelledby="plan-insights-title">
      <header>
        <div>
          <Bot aria-hidden="true" />
          <h2 id="plan-insights-title">AI 结论</h2>
        </div>
        <span>{confidenceLabel(plan.confidence)}</span>
      </header>

      <dl className="insight-list">
        <div>
          <dt>内容摘要</dt>
          <dd>{plan.summary || '暂无摘要'}</dd>
        </div>
        <div>
          <dt>判断依据</dt>
          <dd>{plan.reason || '暂无说明'}</dd>
        </div>
        <div>
          <dt className="tags-heading">
            <Tag aria-hidden="true" />
            标签
          </dt>
          <dd>
            {plan.tags.length ? (
              <ul className="tag-list" aria-label="标签">
                {plan.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            ) : (
              '暂无标签'
            )}
          </dd>
        </div>
      </dl>

      {plan.relatedBookmarks.length ? (
        <div className="related-list">
          <strong>相关收藏</strong>
          {plan.relatedBookmarks.map((bookmark) => (
            <button
              key={bookmark.id}
              type="button"
              onClick={() => void browser.tabs.create({ url: bookmark.url })}
            >
              <span>{bookmark.title}</span>
              <small>
                {bookmark.relation === 'exact' ? '相同网址' : '相似内容'}
              </small>
              <ExternalLink aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${Math.floor(durationMs / 60_000)} min`;
}

export default function App() {
  const querySessionId = useMemo(
    () => new URLSearchParams(location.search).get('session') ?? undefined,
    []
  );
  const [session, setSession] = useState<CaptureSession>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<AgentAction | ''>('');
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<AgentView>('conversation');
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null
  );
  const [remoteMessageIds, setRemoteMessageIds] = useState<Set<string>>(
    () => new Set()
  );
  const [hasUnreadReply, setHasUnreadReply] = useState(false);
  const sessionRef = useRef<CaptureSession>();
  const busyRef = useRef<AgentAction | ''>('');
  const loadRequestRef = useRef(0);
  const knownMessagesRef = useRef({ sessionId: '', ids: new Set<string>() });
  const handledRemoteCountRef = useRef(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followConversationRef = useRef(false);
  const viewScrollPositionsRef = useRef<Record<AgentView, number>>({
    conversation: 0,
    process: 0
  });

  const commitSession = useCallback((next?: CaptureSession): boolean => {
    const current = sessionRef.current;
    if (next && current?.id === next.id && next.updatedAt < current.updatedAt)
      return false;

    const switched = current?.id !== next?.id;
    if (switched) {
      knownMessagesRef.current = {
        sessionId: next?.id ?? '',
        ids: new Set(next?.messages.map((item) => item.id) ?? [])
      };
      handledRemoteCountRef.current = 0;
      setRemoteMessageIds(new Set());
      setMessage('');
      setPendingMessage(null);
      setError('');
      busyRef.current = '';
      setBusy('');
      setActiveView('conversation');
      setHasUnreadReply(false);
      followConversationRef.current = false;
      viewScrollPositionsRef.current = { conversation: 0, process: 0 };
    } else if (next) {
      const known = knownMessagesRef.current;
      const arrivals = next.messages.filter(
        (item) => item.role === 'assistant' && !known.ids.has(item.id)
      );
      for (const item of next.messages) known.ids.add(item.id);
      if (arrivals.length)
        setRemoteMessageIds((currentIds) => {
          const updated = new Set(currentIds);
          for (const item of arrivals) updated.add(item.id);
          return updated;
        });
    }

    sessionRef.current = next;
    setSession(next);
    return true;
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    try {
      let selected: CaptureSession | null;
      if (querySessionId) {
        selected = (await browser.runtime.sendMessage({
          type: 'capture-agent-get',
          input: { sessionId: querySessionId }
        })) as CaptureSession | null;
      } else {
        selected = (await browser.runtime.sendMessage({
          type: 'capture-agent-get-active'
        })) as CaptureSession | null;
        if (!selected) {
          const pending = (await browser.runtime.sendMessage({
            type: 'capture-agent-list-pending'
          })) as CaptureSession[];
          selected = pending[0] ?? null;
        }
      }
      if (requestId !== loadRequestRef.current) return;
      commitSession(selected ?? undefined);
      setLoadError('');
      setLoadState(selected ? 'ready' : 'empty');
    } catch (caught) {
      if (requestId !== loadRequestRef.current) return;
      const detail =
        caught instanceof Error ? caught.message : '无法读取收藏任务';
      if (sessionRef.current) setError(`任务刷新失败：${detail}`);
      else {
        setLoadError(detail);
        setLoadState('error');
      }
    }
  }, [commitSession, querySessionId]);

  const activeSessionId = session?.id;
  useEffect(() => {
    void load();
    const listener = (event: unknown) => {
      const value = event as { type?: string; sessionId?: string };
      if (
        value.type === 'capture-agent-sessions-changed' &&
        (!querySessionId || value.sessionId === querySessionId)
      )
        void load();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      loadRequestRef.current += 1;
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [load, querySessionId]);

  const scrollConversationToEnd = useCallback(() => {
    conversationEndRef.current?.scrollIntoView?.({ block: 'nearest' });
    followConversationRef.current = true;
    setHasUnreadReply(false);
  }, []);

  const conversationIsNearEnd = useCallback(() => {
    const workspace = workspaceRef.current;
    const end = conversationEndRef.current;
    if (!workspace || !end) return false;
    const workspaceBox = workspace.getBoundingClientRect();
    const endBox = end.getBoundingClientRect();
    return endBox.bottom - workspaceBox.bottom <= 48;
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace) workspace.scrollTop = 0;
    const currentState = sessionRef.current?.state;
    const canFocus =
      currentState === 'pending' ||
      currentState === 'adjusting' ||
      currentState === 'failed' ||
      currentState === 'applied';
    if (canFocus)
      globalThis.setTimeout(
        () => composerRef.current?.focus({ preventScroll: true }),
        0
      );
  }, [activeSessionId]);

  useEffect(() => {
    if (!pendingMessage || pendingMessage.sessionId !== activeSessionId) return;
    globalThis.setTimeout(scrollConversationToEnd, 0);
  }, [activeSessionId, pendingMessage, scrollConversationToEnd]);

  useEffect(() => {
    if (
      !remoteMessageIds.size ||
      remoteMessageIds.size <= handledRemoteCountRef.current
    )
      return;
    handledRemoteCountRef.current = remoteMessageIds.size;
    globalThis.setTimeout(() => {
      if (
        activeView === 'conversation' &&
        (followConversationRef.current || conversationIsNearEnd())
      )
        scrollConversationToEnd();
      else setHasUnreadReply(true);
    }, 0);
  }, [
    activeView,
    conversationIsNearEnd,
    remoteMessageIds,
    scrollConversationToEnd
  ]);

  const act = async (action: AgentAction, messageOverride?: string) => {
    const activeSession = sessionRef.current;
    if (!activeSession || busyRef.current) return;
    const draft = (messageOverride ?? message).trim();
    if (action === 'message' && !draft) return;

    const actionSessionId = activeSession.id;
    busyRef.current = action;
    setBusy(action);
    setError('');
    if (action === 'message') {
      setActiveView('conversation');
      setHasUnreadReply(false);
      followConversationRef.current = true;
      setPendingMessage({
        sessionId: actionSessionId,
        text: draft,
        startedAt: Date.now()
      });
      setMessage('');
    }

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'capture-agent-action',
        input: {
          sessionId: actionSessionId,
          action,
          ...(action === 'message' ? { message: draft } : {})
        }
      })) as CaptureActionResponse;
      if (!response?.success || !response.session)
        throw new Error(response?.error || '操作未完成');
      if (sessionRef.current?.id !== actionSessionId) return;
      commitSession(response.session);
      if (action === 'message') setPendingMessage(null);
    } catch (caught) {
      if (sessionRef.current?.id !== actionSessionId) return;
      if (action === 'message') {
        setPendingMessage(null);
        setMessage((current) => current || draft);
        globalThis.setTimeout(
          () => composerRef.current?.focus({ preventScroll: true }),
          0
        );
      }
      setError(caught instanceof Error ? caught.message : '操作未完成');
    } finally {
      if (sessionRef.current?.id === actionSessionId) {
        busyRef.current = '';
        setBusy('');
      }
    }
  };

  const retryLoad = () => {
    setLoadError('');
    setLoadState('loading');
    void load();
  };

  if (loadState === 'loading')
    return (
      <main className="agent-empty agent-loading" role="status">
        <span className="empty-icon">
          <LoaderCircle className="inline-spinner" aria-hidden="true" />
        </span>
        <div>
          <strong>正在读取收藏任务</strong>
          <p>收藏已经保存在浏览器中。</p>
        </div>
      </main>
    );

  if (loadState === 'error')
    return (
      <main className="agent-empty agent-load-error">
        <span className="empty-icon">
          <AlertTriangle aria-hidden="true" />
        </span>
        <div>
          <strong>暂时无法读取任务</strong>
          <p>{loadError}</p>
        </div>
        <button type="button" onClick={retryLoad}>
          <RotateCw aria-hidden="true" />
          重新读取
        </button>
      </main>
    );

  if (!session)
    return (
      <main className="agent-empty">
        <span className="empty-icon">
          <Bot aria-hidden="true" />
        </span>
        <div>
          <strong>没有进行中的收藏</strong>
          <p>使用 Ctrl+D 收藏网页，Agent 会在需要确认时出现在这里。</p>
        </div>
        <button
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <Settings aria-hidden="true" />
          打开设置
        </button>
      </main>
    );

  const plan = session.plan;
  const isAdjusting = session.state === 'adjusting' || busy === 'message';
  const canDecide = session.state === 'pending' && !busy;
  const showDecisionActions = [
    'ready',
    'pending',
    'adjusting',
    'executing'
  ].includes(session.state);
  const canChat =
    session.state === 'pending' ||
    session.state === 'adjusting' ||
    session.state === 'failed' ||
    session.state === 'applied';
  const titleChanged = Boolean(
    plan && plan.title.trim() !== session.sourceSnapshot.title.trim()
  );
  const quickAdjustments = plan
    ? buildQuickAdjustments(plan, session.sourceSnapshot.title)
    : [];
  const matchingPendingMessage = pendingMessage
    ? [...session.messages]
        .reverse()
        .find(
          (item) =>
            item.role === 'user' &&
            item.text === pendingMessage.text &&
            item.createdAt >= pendingMessage.startedAt - 2_000
        )
    : undefined;
  const latestAssistantId = [...session.messages]
    .reverse()
    .find((item) => item.role === 'assistant')?.id;
  const optimisticMessageVisible = Boolean(
    pendingMessage &&
    pendingMessage.sessionId === session.id &&
    !matchingPendingMessage
  );
  const visibleMessageCount =
    session.messages.length + (optimisticMessageVisible ? 1 : 0);
  const completedActivities = session.activities.filter((activity) =>
    ['completed', 'skipped'].includes(activity.status)
  ).length;
  const showFooter =
    canChat ||
    showDecisionActions ||
    session.state === 'failed' ||
    Boolean(session.state === 'applied' && session.operationBatchId) ||
    Boolean(error);

  const selectView = (view: AgentView) => {
    if (activeView === view) return;
    const workspace = workspaceRef.current;
    if (workspace)
      viewScrollPositionsRef.current[activeView] = workspace.scrollTop;
    setActiveView(view);
    globalThis.setTimeout(() => {
      const currentWorkspace = workspaceRef.current;
      if (currentWorkspace)
        currentWorkspace.scrollTop = viewScrollPositionsRef.current[view];
    }, 0);
    if (view === 'process') followConversationRef.current = false;
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextView: AgentView =
      event.key === 'ArrowLeft' || event.key === 'Home'
        ? 'conversation'
        : 'process';
    selectView(nextView);
    globalThis.setTimeout(
      () => document.getElementById(`agent-tab-${nextView}`)?.focus(),
      0
    );
  };

  const showLatestReply = () => {
    selectView('conversation');
    setHasUnreadReply(false);
    followConversationRef.current = true;
    globalThis.setTimeout(scrollConversationToEnd, 0);
  };

  const handleWorkspaceScroll = () => {
    const workspace = workspaceRef.current;
    if (workspace)
      viewScrollPositionsRef.current[activeView] = workspace.scrollTop;
    if (activeView !== 'conversation') return;
    const nearEnd = conversationIsNearEnd();
    followConversationRef.current = nearEnd;
    if (nearEnd && hasUnreadReply) setHasUnreadReply(false);
  };

  return (
    <main className="agent-shell">
      <header className="agent-topbar">
        <div className="agent-brand">
          <BrandMark className="agent-brand-icon" />
          <div>
            <h1>Siftmark Agent</h1>
            <span
              className="agent-state"
              data-state={session.state}
              aria-live="polite"
            >
              <i aria-hidden="true" />
              {stateLabel(session)}
            </span>
          </div>
        </div>
        <div className="agent-topbar-actions">
          {hasUnreadReply ? (
            <button
              type="button"
              className="agent-new-reply"
              onClick={showLatestReply}
            >
              <ArrowDown aria-hidden="true" />
              新回复
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            title="打开原网页"
            aria-label="打开原网页"
            disabled={!session.sourceSnapshot.url}
            onClick={() =>
              void browser.tabs.create({ url: session.sourceSnapshot.url })
            }
          >
            <ExternalLink aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={workspaceRef}
        className="agent-workspace"
        data-view={activeView}
        onScroll={handleWorkspaceScroll}
      >
        <section className="source-card" aria-labelledby="source-title">
          <div className="card-kicker">
            <Globe2 aria-hidden="true" />
            <span>当前网页</span>
          </div>
          <h2 id="source-title">{session.sourceSnapshot.title}</h2>
          <p>{formatSourceUrl(session.sourceSnapshot.url)}</p>
        </section>

        <div className="agent-view-tabs" role="tablist" aria-label="Agent 视图">
          <button
            id="agent-tab-conversation"
            type="button"
            role="tab"
            aria-selected={activeView === 'conversation'}
            aria-controls="agent-panel-conversation"
            tabIndex={activeView === 'conversation' ? 0 : -1}
            onClick={() => selectView('conversation')}
            onKeyDown={handleTabKeyDown}
          >
            <MessageCircle aria-hidden="true" />
            <span>对话</span>
            <small>{visibleMessageCount}</small>
          </button>
          <button
            id="agent-tab-process"
            type="button"
            role="tab"
            aria-selected={activeView === 'process'}
            aria-controls="agent-panel-process"
            tabIndex={activeView === 'process' ? 0 : -1}
            onClick={() => selectView('process')}
            onKeyDown={handleTabKeyDown}
          >
            <ListTree aria-hidden="true" />
            <span>过程</span>
            <small>
              {completedActivities}/{session.activities.length}
            </small>
          </button>
        </div>

        <section
          id="agent-panel-conversation"
          className="agent-view-panel conversation-view"
          role="tabpanel"
          aria-labelledby="agent-tab-conversation"
          hidden={activeView !== 'conversation'}
        >
          <section className="proposal-card" aria-label="整理方案">
            <div className="proposal-header">
              <div className="card-kicker proposal-kicker">
                <Sparkles aria-hidden="true" />
                <span>{latestAssistantId ? '调整后的方案' : '整理方案'}</span>
              </div>
              {plan ? (
                <span
                  className="confidence-badge"
                  data-confidence={plan.confidence}
                >
                  {confidenceLabel(plan.confidence)}
                </span>
              ) : null}
            </div>

            {plan ? (
              <>
                <div className="plan-field title-field">
                  <span className="field-label">
                    <Bookmark aria-hidden="true" />
                    收藏标题
                    {titleChanged ? (
                      <small className="changed-badge">已优化</small>
                    ) : null}
                  </span>
                  <h2 id="proposal-title">{plan.title}</h2>
                </div>

                <div className="plan-field destination-field">
                  <span className="field-label">
                    <Folder aria-hidden="true" />
                    收藏位置
                  </span>
                  <ol className="agent-route" aria-label="收藏位置">
                    {plan.destination.path.map((folder, index) => (
                      <li key={folder.id} data-kind="existing">
                        {index > 0 ? <ChevronRight aria-hidden="true" /> : null}
                        <span>
                          <Folder aria-hidden="true" />
                          {folder.title}
                        </span>
                      </li>
                    ))}
                    {plan.destination.newFolders.map((folder, index) => (
                      <li key={`${folder}-${index}`} data-kind="new">
                        {plan.destination.path.length > 0 || index > 0 ? (
                          <ChevronRight aria-hidden="true" />
                        ) : null}
                        <span>
                          <FolderPlus aria-hidden="true" />
                          {folder}
                          <small>新建</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                {session.risk?.reasons.length ? (
                  <section className="risk-panel" aria-labelledby="risk-title">
                    <AlertTriangle aria-hidden="true" />
                    <div>
                      <strong id="risk-title">需要你的批准</strong>
                      {!session.risk.canExecute ? (
                        <p>当前方案暂不可执行，请先让 Agent 调整。</p>
                      ) : null}
                      <ul>
                        {session.risk.reasons.map((reason) => (
                          <li key={reason}>{riskLabels[reason]}</li>
                        ))}
                      </ul>
                    </div>
                  </section>
                ) : null}
              </>
            ) : session.failure ? (
              <div className="failure-copy">
                <AlertTriangle aria-hidden="true" />
                <p>{session.failure.message}</p>
              </div>
            ) : (
              <div className="proposal-loading" role="status">
                <LoaderCircle className="inline-spinner" aria-hidden="true" />
                正在生成收藏方案…
              </div>
            )}
          </section>

          <section className="agent-conversation" aria-labelledby="chat-title">
            <div className="conversation-heading">
              <div>
                <h2 id="chat-title">与 Agent 调整</h2>
                <p>对话只会修改这一次收藏方案</p>
              </div>
              <span>{visibleMessageCount} 条</span>
            </div>

            <div
              className="message-list"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-busy={isAdjusting}
            >
              {visibleMessageCount ? (
                <>
                  {session.messages.map((item) => {
                    const itemPending =
                      item.id === matchingPendingMessage?.id && isAdjusting;
                    const isLatestAssistant =
                      item.role === 'assistant' &&
                      item.id === latestAssistantId;
                    return (
                      <article
                        key={item.id}
                        data-role={item.role}
                        data-pending={itemPending ? 'true' : undefined}
                        data-arrival={
                          remoteMessageIds.has(item.id) ? 'remote' : undefined
                        }
                      >
                        <header>
                          <span>{item.role === 'user' ? '你' : 'Agent'}</span>
                          {itemPending ? <small>发送中</small> : null}
                        </header>
                        <p>{item.text}</p>
                        {isLatestAssistant && plan ? (
                          <div className="message-plan-update">
                            <CheckCircle2 aria-hidden="true" />
                            <span>方案已更新</span>
                            <small>{planDestinationLabel(plan)}</small>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {optimisticMessageVisible && pendingMessage ? (
                    <article
                      key={`optimistic-${pendingMessage.startedAt}`}
                      data-role="user"
                      data-pending="true"
                    >
                      <header>
                        <span>你</span>
                        <small>发送中</small>
                      </header>
                      <p>{pendingMessage.text}</p>
                    </article>
                  ) : null}
                </>
              ) : (
                <div className="conversation-empty">
                  <MessageCircle aria-hidden="true" />
                  <p>
                    {canChat
                      ? '直接告诉 Agent 要改的目录、标题或规则，也可以使用下方的一键调整。'
                      : '方案准备好后，可以在这里继续调整。'}
                  </p>
                </div>
              )}
              {isAdjusting ? (
                <div className="replanning-status" role="status">
                  <LoaderCircle className="inline-spinner" aria-hidden="true" />
                  Agent 正在检查目录并更新方案…
                </div>
              ) : null}
              <div ref={conversationEndRef} className="conversation-end" />
            </div>
          </section>
        </section>

        <section
          id="agent-panel-process"
          className="agent-view-panel process-view"
          role="tabpanel"
          aria-labelledby="agent-tab-process"
          hidden={activeView !== 'process'}
        >
          <AnalysisTrace activities={session.activities ?? []} />
          {plan ? <PlanInsights plan={plan} /> : null}
        </section>
      </div>

      {showFooter ? (
        <footer className="agent-footer">
          {error ? (
            <p role="alert" className="agent-error">
              {error}
            </p>
          ) : null}

          {canChat ? (
            <>
              {quickAdjustments.length ? (
                <section className="quick-adjustments" aria-label="一键调整">
                  <span>一键调整</span>
                  <div>
                    {quickAdjustments.map((adjustment) => (
                      <button
                        key={adjustment.label}
                        type="button"
                        disabled={
                          Boolean(busy) || session.state === 'adjusting'
                        }
                        onClick={() => void act('message', adjustment.message)}
                      >
                        {adjustment.label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="agent-composer" aria-busy={isAdjusting}>
                <div className="composer-heading">
                  <label htmlFor="agent-message">告诉 Agent 怎么改</label>
                  <span>
                    {isAdjusting
                      ? '回复后即可继续发送'
                      : session.state === 'failed'
                        ? '补充要求后重新尝试'
                        : '仅影响本次收藏'}
                  </span>
                </div>
                <div className="composer-input">
                  <textarea
                    ref={composerRef}
                    id="agent-message"
                    rows={1}
                    value={message}
                    maxLength={2_000}
                    placeholder={
                      isAdjusting
                        ? '可以先写下一条…'
                        : session.state === 'failed'
                          ? '例如：不要新建目录，继续尝试'
                          : '例如：换到产品目录'
                    }
                    disabled={Boolean(busy && busy !== 'message')}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing &&
                        !isAdjusting &&
                        !busyRef.current
                      ) {
                        event.preventDefault();
                        void act('message');
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="send-button"
                    title={isAdjusting ? 'Agent 正在回复' : '发送'}
                    aria-label={isAdjusting ? 'Agent 正在回复' : '发送'}
                    disabled={
                      !message.trim() ||
                      Boolean(busy) ||
                      session.state === 'adjusting'
                    }
                    onClick={() => void act('message')}
                  >
                    {isAdjusting ? (
                      <LoaderCircle
                        className="send-spinner"
                        aria-hidden="true"
                      />
                    ) : (
                      <Send aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p className="composer-hint">
                  <kbd>Enter</kbd> 发送 · <kbd>Shift + Enter</kbd> 换行
                </p>
              </div>
            </>
          ) : null}

          <div
            className="agent-actions"
            aria-busy={
              Boolean(busy) || isAdjusting || session.state === 'executing'
            }
          >
            {showDecisionActions ? (
              <div>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={!canDecide}
                  onClick={() => void act('reject')}
                >
                  {busy === 'reject' ? (
                    <LoaderCircle
                      className="inline-spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <X aria-hidden="true" />
                  )}
                  {busy === 'reject' ? '拒绝中' : '拒绝'}
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={!canDecide || session.risk?.canExecute === false}
                  onClick={() => void act('allow')}
                >
                  {busy === 'allow' || session.state === 'executing' ? (
                    <LoaderCircle
                      className="inline-spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                  {busy === 'allow' || session.state === 'executing'
                    ? '执行中'
                    : isAdjusting
                      ? '调整中'
                      : session.state === 'ready'
                        ? '准备中'
                        : '允许'}
                </button>
              </div>
            ) : null}
            {session.state === 'applied' && session.operationBatchId ? (
              <button
                type="button"
                className="secondary-action standalone-action"
                disabled={Boolean(busy)}
                onClick={() => void act('undo')}
              >
                {busy === 'undo' ? (
                  <LoaderCircle className="inline-spinner" aria-hidden="true" />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
                {busy === 'undo' ? '撤销中' : '撤销本次整理'}
              </button>
            ) : null}
            {session.state === 'failed' ? (
              <div className="failed-actions">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={Boolean(busy)}
                  onClick={() => void act('end')}
                >
                  <X aria-hidden="true" />
                  {busy === 'end' ? '结束中' : '结束任务'}
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={Boolean(busy)}
                  onClick={() => void act('retry')}
                >
                  {busy === 'retry' ? (
                    <LoaderCircle
                      className="inline-spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <RotateCw aria-hidden="true" />
                  )}
                  {busy === 'retry' ? '重试中' : '重试分析'}
                </button>
              </div>
            ) : null}
          </div>
        </footer>
      ) : null}
    </main>
  );
}

function buildQuickAdjustments(
  plan: CapturePlan,
  originalTitle: string
): QuickAdjustment[] {
  const adjustments: QuickAdjustment[] = [];
  if (plan.destination.newFolders.length)
    adjustments.push({
      label: '不要新建目录',
      message: '不要新建目录，请改用已有目录'
    });
  if (plan.title.trim() !== originalTitle.trim())
    adjustments.push({
      label: '保留原标题',
      message: '保留原标题，不要修改标题'
    });
  adjustments.push({
    label: '换个目录',
    message: '请换一个更合适的已有目录'
  });
  return adjustments;
}

function formatSourceUrl(url?: string): string {
  if (!url) return '本地页面';
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

function confidenceLabel(confidence: CapturePlan['confidence']): string {
  if (confidence === 'high') return '高置信度';
  if (confidence === 'medium') return '中置信度';
  if (confidence === 'low') return '低置信度';
  return '置信度未知';
}

function planDestinationLabel(plan: CapturePlan): string {
  return (
    [
      ...plan.destination.path.map((folder) => folder.title),
      ...plan.destination.newFolders
    ].join(' / ') || '书签栏'
  );
}

function stateLabel(session: CaptureSession): string {
  if (session.state === 'pending') return '等待批准';
  if (session.state === 'adjusting') return '正在调整';
  if (session.state === 'applied')
    return session.resolution === 'auto' ? '已自动整理' : '已执行';
  if (session.state === 'rejected') return '已拒绝';
  if (session.state === 'failed') return '需要处理';
  if (session.state === 'undone') return '已撤销';
  if (session.state === 'ended') return '已结束';
  if (session.state === 'expired') return '已过期';
  if (session.state === 'executing') return '正在执行';
  return '分析中';
}
