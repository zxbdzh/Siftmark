import {
  AlertTriangle,
  Bookmark,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Folder,
  FolderPlus,
  Globe2,
  LoaderCircle,
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

interface CaptureActionResponse {
  success?: boolean;
  session?: CaptureSession;
  error?: string;
}

type AgentAction = 'allow' | 'reject' | 'undo' | 'retry' | 'message';

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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<AgentAction | ''>('');
  const [error, setError] = useState('');
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const scrollStateRef = useRef({ sessionId: '', messageCount: 0 });

  const load = useCallback(async () => {
    const selected = querySessionId
      ? ((await browser.runtime.sendMessage({
          type: 'capture-agent-get',
          input: { sessionId: querySessionId }
        })) as CaptureSession | null)
      : ((await browser.runtime.sendMessage({
          type: 'capture-agent-get-active'
        })) as CaptureSession | null);
    if (selected) {
      setSession(selected);
      return;
    }
    const pending = (await browser.runtime.sendMessage({
      type: 'capture-agent-list-pending'
    })) as CaptureSession[];
    setSession(pending[0]);
  }, [querySessionId]);

  const activeSessionId = session?.id;
  useEffect(() => {
    void load();
    const listener = (event: unknown) => {
      const value = event as { type?: string; sessionId?: string };
      if (
        value.type === 'capture-agent-sessions-changed' &&
        (!activeSessionId || value.sessionId === activeSessionId)
      )
        void load();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [activeSessionId, load]);

  const messageCount = session?.messages.length ?? 0;
  useEffect(() => {
    const sessionId = activeSessionId ?? '';
    const previous = scrollStateRef.current;
    const shouldScroll =
      previous.sessionId === sessionId &&
      (messageCount > previous.messageCount || busy === 'message');
    scrollStateRef.current = { sessionId, messageCount };
    if (shouldScroll)
      conversationEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeSessionId, busy, messageCount]);

  const act = async (action: AgentAction, messageOverride?: string) => {
    if (!session || busy) return;
    const draft = (messageOverride ?? message).trim();
    if (action === 'message' && !draft) return;

    setBusy(action);
    setError('');
    if (action === 'message') setMessage('');

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'capture-agent-action',
        input: {
          sessionId: session.id,
          action,
          ...(action === 'message' ? { message: draft } : {})
        }
      })) as CaptureActionResponse;
      if (!response?.success || !response.session)
        throw new Error(response?.error || '操作未完成');
      setSession(response.session);
    } catch (caught) {
      if (action === 'message') setMessage(draft);
      setError(caught instanceof Error ? caught.message : '操作未完成');
    } finally {
      setBusy('');
    }
  };

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
  const canDecide =
    session.state === 'pending' || session.state === 'adjusting';
  const canChat = canDecide || session.state === 'applied';
  const titleChanged = Boolean(
    plan && plan.title.trim() !== session.sourceSnapshot.title.trim()
  );
  const quickAdjustments = plan
    ? buildQuickAdjustments(plan, session.sourceSnapshot.title)
    : [];

  return (
    <main className="agent-shell">
      <header className="agent-topbar">
        <div className="agent-brand">
          <span className="agent-brand-icon">
            <Bot aria-hidden="true" />
          </span>
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
      </header>

      <div className="agent-workspace">
        <section className="source-card" aria-labelledby="source-title">
          <div className="card-kicker">
            <Globe2 aria-hidden="true" />
            <span>当前网页</span>
          </div>
          <h2 id="source-title">{session.sourceSnapshot.title}</h2>
          <p>{formatSourceUrl(session.sourceSnapshot.url)}</p>
        </section>

        <AnalysisTrace activities={session.activities ?? []} />

        <section className="proposal-card" aria-label="整理方案">
          <div className="proposal-header">
            <div className="card-kicker proposal-kicker">
              <Sparkles aria-hidden="true" />
              <span>整理方案</span>
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
                    <p>
                      {session.risk.canExecute
                        ? '方案包含以下风险操作，允许后才会整理。'
                        : '当前方案暂不可执行，请先让 Agent 调整。'}
                    </p>
                    <ul>
                      {session.risk.reasons.map((reason) => (
                        <li key={reason}>{riskLabels[reason]}</li>
                      ))}
                    </ul>
                  </div>
                </section>
              ) : null}

              <details className="analysis-details">
                <summary>
                  <span>
                    <Sparkles aria-hidden="true" />
                    查看 AI 分析
                  </span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="analysis-content">
                  <div>
                    <strong>内容摘要</strong>
                    <p>{plan.summary || '暂无摘要'}</p>
                  </div>
                  <div>
                    <strong>判断依据</strong>
                    <p>{plan.reason || '暂无说明'}</p>
                  </div>
                  <div>
                    <strong className="tags-heading">
                      <Tag aria-hidden="true" />
                      标签
                    </strong>
                    {plan.tags.length ? (
                      <ul className="tag-list" aria-label="标签">
                        {plan.tags.map((tag) => (
                          <li key={tag}>{tag}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>暂无标签</p>
                    )}
                  </div>
                  {plan.relatedBookmarks.length ? (
                    <div className="related-list">
                      <strong>相关收藏</strong>
                      {plan.relatedBookmarks.map((bookmark) => (
                        <button
                          key={bookmark.id}
                          type="button"
                          onClick={() =>
                            void browser.tabs.create({ url: bookmark.url })
                          }
                        >
                          <span>{bookmark.title}</span>
                          <small>
                            {bookmark.relation === 'exact'
                              ? '相同网址'
                              : '相似内容'}
                          </small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            </>
          ) : session.failure ? (
            <div className="failure-copy">
              <AlertTriangle aria-hidden="true" />
              <p>{session.failure.message}</p>
            </div>
          ) : (
            <div className="proposal-loading" role="status">
              <span aria-hidden="true" />
              正在生成收藏方案…
            </div>
          )}
        </section>

        <section className="agent-conversation" aria-labelledby="chat-title">
          <div className="conversation-heading">
            <div>
              <h2 id="chat-title">调整记录</h2>
              <p>对话只会修改这一次收藏方案</p>
            </div>
            <span>{session.messages.length} 条</span>
          </div>

          <div className="message-list" aria-live="polite">
            {session.messages.length ? (
              session.messages.map((item) => (
                <article key={item.id} data-role={item.role}>
                  <span>{item.role === 'user' ? '你' : 'Agent'}</span>
                  <p>{item.text}</p>
                </article>
              ))
            ) : (
              <div className="conversation-empty">
                <Sparkles aria-hidden="true" />
                <p>
                  {canChat
                    ? '想改目录或标题，直接告诉 Agent；也可以使用下方的一键调整。'
                    : '本次收藏还没有调整记录。'}
                </p>
              </div>
            )}
            {busy === 'message' ? (
              <div className="replanning-status" role="status">
                <span aria-hidden="true" />
                正在重新规划方案…
              </div>
            ) : null}
            <div ref={conversationEndRef} />
          </div>
        </section>
      </div>

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
                      disabled={Boolean(busy)}
                      onClick={() => void act('message', adjustment.message)}
                    >
                      {adjustment.label}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="agent-composer">
              <div className="composer-heading">
                <label htmlFor="agent-message">调整收藏方案</label>
                <span>仅影响本次收藏</span>
              </div>
              <div className="composer-input">
                <textarea
                  id="agent-message"
                  rows={2}
                  value={message}
                  maxLength={2_000}
                  placeholder="例如：换到产品目录"
                  disabled={Boolean(busy)}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void act('message');
                    }
                  }}
                />
                <button
                  type="button"
                  className="send-button"
                  title={busy === 'message' ? '正在发送' : '发送'}
                  aria-label={busy === 'message' ? '正在发送' : '发送'}
                  disabled={!message.trim() || Boolean(busy)}
                  onClick={() => void act('message')}
                >
                  {busy === 'message' ? (
                    <LoaderCircle className="send-spinner" aria-hidden="true" />
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

        <div className="agent-actions">
          {canDecide ? (
            <>
              <div>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={Boolean(busy)}
                  onClick={() => void act('reject')}
                >
                  <X aria-hidden="true" />
                  拒绝
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={Boolean(busy) || session.risk?.canExecute === false}
                  onClick={() => void act('allow')}
                >
                  <Check aria-hidden="true" />
                  {busy === 'allow' ? '执行中' : '允许'}
                </button>
              </div>
            </>
          ) : null}
          {session.state === 'applied' && session.operationBatchId ? (
            <button
              type="button"
              className="secondary-action standalone-action"
              disabled={Boolean(busy)}
              onClick={() => void act('undo')}
            >
              <RotateCcw aria-hidden="true" />
              撤销本次整理
            </button>
          ) : null}
          {session.state === 'failed' ? (
            <button
              type="button"
              className="primary-action standalone-action"
              disabled={Boolean(busy)}
              onClick={() => void act('retry')}
            >
              <RotateCw aria-hidden="true" />
              {busy === 'retry' ? '重试中' : '重试分析'}
            </button>
          ) : null}
        </div>
      </footer>
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

function stateLabel(session: CaptureSession): string {
  if (session.state === 'pending' || session.state === 'adjusting')
    return '等待决定';
  if (session.state === 'applied')
    return session.resolution === 'auto' ? '已自动整理' : '已执行';
  if (session.state === 'rejected') return '已拒绝';
  if (session.state === 'failed') return '需要处理';
  if (session.state === 'undone') return '已撤销';
  if (session.state === 'expired') return '已过期';
  if (session.state === 'executing') return '正在执行';
  return '分析中';
}
