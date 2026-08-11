import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../entrypoints/sidepanel/App';
import type { CaptureSession } from '../../../src/capture-agent';

interface RuntimeRequest {
  type: string;
  input?: {
    sessionId?: string;
    action?: string;
    message?: string;
  };
}

interface ActionResponse {
  success?: boolean;
  session?: CaptureSession;
  error?: string;
}

const session: CaptureSession = {
  id: 'session-1',
  bookmarkId: 'bookmark-1',
  trigger: 'native-bookmark',
  sourceSnapshot: {
    id: 'bookmark-1',
    parentId: 'inbox',
    index: 0,
    title: '原始页面标题',
    url: 'https://example.com/article'
  },
  state: 'pending',
  plan: {
    destination: {
      folderId: 'development',
      path: [{ id: 'development', title: '开发' }],
      newFolders: ['Agent']
    },
    title: '更清晰的页面标题',
    tags: ['AI', '浏览器'],
    summary: '关于浏览器收藏 Agent 的设计。',
    confidence: 'medium',
    reason: '内容与开发工具相关。',
    relatedBookmarks: [],
    generatedAt: 1
  },
  risk: {
    decision: 'approval',
    reasons: ['new-folder'],
    canExecute: true
  },
  activities: [
    {
      id: 'capture',
      kind: 'capture',
      status: 'completed',
      label: '原生书签已保存',
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: 'folder-candidates',
      kind: 'folders',
      status: 'completed',
      label: '已比较候选目录',
      detail: '找到 8 个相关目录',
      facts: [
        { label: '送入模型', value: '8 个候选' },
        { label: '本地信号', value: '2 条偏好或记忆' }
      ],
      durationMs: 42,
      createdAt: 2,
      updatedAt: 2
    },
    {
      id: 'risk-check',
      kind: 'risk',
      status: 'completed',
      label: '风险检查完成',
      detail: '发现 1 项需要批准',
      createdAt: 3,
      updatedAt: 3
    }
  ],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  expiresAt: Date.now() + 60_000
};

function cloneSession(
  id = session.id,
  sourceTitle = session.sourceSnapshot.title,
  updatedAt = session.updatedAt
): CaptureSession {
  const next = structuredClone(session);
  next.id = id;
  next.bookmarkId = `bookmark-${id}`;
  next.sourceSnapshot.id = next.bookmarkId;
  next.sourceSnapshot.title = sourceTitle;
  next.updatedAt = updatedAt;
  return next;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Side panel Agent workspace', () => {
  const sendMessage = vi.fn();
  let activeSession: CaptureSession | null;
  let sessions: Map<string, CaptureSession>;
  let runtimeListener: ((event: unknown) => void) | undefined;

  const handleRequest = async (request: RuntimeRequest) => {
    if (request.type === 'capture-agent-get-active') return activeSession;
    if (request.type === 'capture-agent-get')
      return sessions.get(request.input?.sessionId ?? '') ?? null;
    if (request.type === 'capture-agent-list-pending')
      return [...sessions.values()].filter((item) => item.state === 'pending');
    if (request.type === 'capture-agent-action') {
      const selected = sessions.get(request.input?.sessionId ?? '');
      return selected
        ? { success: true, session: selected }
        : { success: false, error: '任务不存在' };
    }
    return null;
  };

  beforeEach(() => {
    window.history.replaceState({}, '', '/sidepanel.html');
    activeSession = cloneSession();
    sessions = new Map([[activeSession.id, activeSession]]);
    runtimeListener = undefined;
    sendMessage.mockReset();
    sendMessage.mockImplementation(handleRequest);
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage,
        openOptionsPage: vi.fn(),
        onMessage: {
          addListener: vi.fn((listener: (event: unknown) => void) => {
            runtimeListener = listener;
          }),
          removeListener: vi.fn()
        }
      },
      tabs: { create: vi.fn() }
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/sidepanel.html');
    vi.unstubAllGlobals();
  });

  it('opens on the proposal and conversation, with detailed reasoning in the process tab', async () => {
    render(<App />);

    expect(await screen.findByText('更清晰的页面标题')).toBeVisible();
    const conversationTab = screen.getByRole('tab', { name: /对话/ });
    const processTab = screen.getByRole('tab', { name: /过程/ });
    const processPanel = document.getElementById('agent-panel-process');
    expect(conversationTab).toHaveAttribute('aria-selected', 'true');
    expect(processPanel).toHaveAttribute('hidden');

    fireEvent.keyDown(conversationTab, { key: 'ArrowRight' });
    await waitFor(() => expect(processTab).toHaveFocus());
    expect(processTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '分析过程' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'AI 结论' })).toBeVisible();
    expect(screen.getByText('内容与开发工具相关。')).toBeVisible();

    fireEvent.keyDown(processTab, { key: 'Home' });
    await waitFor(() => expect(conversationTab).toHaveFocus());
    expect(conversationTab).toHaveAttribute('aria-selected', 'true');
  });

  it('preserves independent scroll positions across instant view switches', async () => {
    const { container } = render(<App />);
    await screen.findByText('更清晰的页面标题');
    const workspace = container.querySelector<HTMLElement>('.agent-workspace');
    expect(workspace).not.toBeNull();
    workspace!.scrollTop = 120;
    fireEvent.scroll(workspace!);

    fireEvent.click(screen.getByRole('tab', { name: /过程/ }));
    await waitFor(() => expect(workspace!.scrollTop).toBe(0));
    workspace!.scrollTop = 240;
    fireEvent.scroll(workspace!);

    fireEvent.click(screen.getByRole('tab', { name: /对话/ }));
    await waitFor(() => expect(workspace!.scrollTop).toBe(120));
    fireEvent.click(screen.getByRole('tab', { name: /过程/ }));
    await waitFor(() => expect(workspace!.scrollTop).toBe(240));
  });

  it('shows an optimistic user message immediately and keeps the composer editable', async () => {
    const pendingAction = createDeferred<ActionResponse>();
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'capture-agent-action') return pendingAction.promise;
      return handleRequest(request);
    });
    render(<App />);
    const composer = await screen.findByRole('textbox', {
      name: '告诉 Agent 怎么改'
    });

    fireEvent.change(composer, { target: { value: '换到产品目录' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => expect(actionRequests()).toHaveLength(1));
    expect(
      screen.getByText('换到产品目录', {
        selector: '.message-list article p'
      })
    ).toBeVisible();
    expect(composer).toBeEnabled();
    expect(composer).toHaveValue('');
    fireEvent.change(composer, { target: { value: '下一条调整' } });
    expect(composer).toHaveValue('下一条调整');

    const now = Date.now();
    const completed = cloneSession(session.id, session.sourceSnapshot.title, 2);
    completed.messages = [
      { id: 'user-1', role: 'user', text: '换到产品目录', createdAt: now },
      {
        id: 'assistant-1',
        role: 'assistant',
        text: '已换到产品目录。',
        createdAt: now + 1
      }
    ];
    await act(async () =>
      pendingAction.resolve({ success: true, session: completed })
    );
    expect(await screen.findByText('已换到产品目录。')).toBeVisible();
  });

  it('keeps Shift+Enter available without sending', async () => {
    render(<App />);
    const composer = await screen.findByRole('textbox', {
      name: '告诉 Agent 怎么改'
    });
    fireEvent.change(composer, { target: { value: '换到产品目录' } });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(actionRequests()).toHaveLength(0);
  });

  it('offers one-click adjustments based on the current proposal', async () => {
    render(<App />);
    await screen.findByText('更清晰的页面标题');

    fireEvent.click(screen.getByRole('button', { name: '不要新建目录' }));
    await waitFor(() => expect(actionRequests()).toHaveLength(1));
    expect(actionRequests()[0]).toMatchObject({
      input: { action: 'message', message: '不要新建目录，请改用已有目录' }
    });
  });

  it('follows a newly active Ctrl+D session when the panel is not pinned', async () => {
    render(<App />);
    const composer = await screen.findByRole('textbox', {
      name: '告诉 Agent 怎么改'
    });
    fireEvent.change(composer, { target: { value: '旧任务草稿' } });
    fireEvent.click(screen.getByRole('tab', { name: /过程/ }));

    const next = cloneSession('session-2', '第二个网页', 2);
    activeSession = next;
    sessions.set(next.id, next);
    await act(async () => {
      runtimeListener?.({
        type: 'capture-agent-sessions-changed',
        sessionId: next.id
      });
    });

    expect(await screen.findByText('第二个网页')).toBeVisible();
    expect(screen.getByRole('tab', { name: /对话/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(
      screen.getByRole('textbox', { name: '告诉 Agent 怎么改' })
    ).toHaveValue('');
  });

  it('keeps a query-pinned session isolated from other session events', async () => {
    window.history.replaceState({}, '', '/sidepanel.html?session=session-1');
    const pinned = cloneSession();
    const other = cloneSession('session-2', '第二个网页', 2);
    sessions = new Map([
      [pinned.id, pinned],
      [other.id, other]
    ]);
    activeSession = other;
    render(<App />);
    expect(await screen.findByText('原始页面标题')).toBeVisible();
    const requestCount = sendMessage.mock.calls.length;

    await act(async () => {
      runtimeListener?.({
        type: 'capture-agent-sessions-changed',
        sessionId: other.id
      });
      await Promise.resolve();
    });

    expect(screen.getByText('原始页面标题')).toBeVisible();
    expect(screen.queryByText('第二个网页')).not.toBeInTheDocument();
    expect(sendMessage.mock.calls).toHaveLength(requestCount);
  });

  it('does not let an old action response switch the panel back to a previous session', async () => {
    const pendingAction = createDeferred<ActionResponse>();
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'capture-agent-action') return pendingAction.promise;
      return handleRequest(request);
    });
    render(<App />);
    const composer = await screen.findByRole('textbox', {
      name: '告诉 Agent 怎么改'
    });
    fireEvent.change(composer, { target: { value: '修改旧任务' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(actionRequests()).toHaveLength(1));

    const next = cloneSession('session-2', '当前新任务', 2);
    activeSession = next;
    sessions.set(next.id, next);
    await act(async () => {
      runtimeListener?.({
        type: 'capture-agent-sessions-changed',
        sessionId: next.id
      });
    });
    expect(await screen.findByText('当前新任务')).toBeVisible();

    const stale = cloneSession('session-1', '不应重新出现', 3);
    await act(async () =>
      pendingAction.resolve({ success: true, session: stale })
    );
    expect(screen.getByText('当前新任务')).toBeVisible();
    expect(screen.queryByText('不应重新出现')).not.toBeInTheDocument();
  });

  it('ignores an older load that resolves after a newer active session', async () => {
    const staleLoad = createDeferred<CaptureSession | null>();
    const current = cloneSession('session-2', '较新的任务', 2);
    let activeLoads = 0;
    sendMessage.mockImplementation((request: RuntimeRequest) => {
      if (request.type === 'capture-agent-get-active') {
        activeLoads += 1;
        return activeLoads === 1 ? staleLoad.promise : Promise.resolve(current);
      }
      return handleRequest(request);
    });
    render(<App />);
    expect(screen.getByText('正在读取收藏任务')).toBeVisible();

    await act(async () => {
      runtimeListener?.({
        type: 'capture-agent-sessions-changed',
        sessionId: current.id
      });
    });
    expect(await screen.findByText('较新的任务')).toBeVisible();

    await act(async () =>
      staleLoad.resolve(cloneSession('session-1', '过期任务', 1))
    );
    expect(screen.getByText('较新的任务')).toBeVisible();
    expect(screen.queryByText('过期任务')).not.toBeInTheDocument();
  });

  it('only marks newly arrived assistant messages for entrance motion', async () => {
    const initial = cloneSession();
    initial.messages = [
      { id: 'assistant-old', role: 'assistant', text: '历史回复', createdAt: 1 }
    ];
    activeSession = initial;
    sessions.set(initial.id, initial);
    render(<App />);
    const historicMessage = await screen.findByText('历史回复');
    expect(historicMessage.closest('article')).not.toHaveAttribute(
      'data-arrival'
    );

    const updated = structuredClone(initial);
    updated.updatedAt = 2;
    updated.messages.push({
      id: 'assistant-new',
      role: 'assistant',
      text: '新的 Agent 回复',
      createdAt: 2
    });
    activeSession = updated;
    sessions.set(updated.id, updated);
    await act(async () => {
      runtimeListener?.({
        type: 'capture-agent-sessions-changed',
        sessionId: updated.id
      });
    });

    const newMessage = await screen.findByText('新的 Agent 回复');
    expect(newMessage.closest('article')).toHaveAttribute(
      'data-arrival',
      'remote'
    );
    expect(historicMessage.closest('article')).not.toHaveAttribute(
      'data-arrival'
    );
  });

  it('offers a new-reply jump without interrupting the process view', async () => {
    render(<App />);
    await screen.findByText('更清晰的页面标题');
    fireEvent.click(screen.getByRole('tab', { name: /过程/ }));
    expect(screen.getByRole('tab', { name: /过程/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    const updated = cloneSession(session.id, session.sourceSnapshot.title, 2);
    updated.messages = [
      {
        id: 'assistant-new',
        role: 'assistant',
        text: 'Agent 已经完成新的目录比较。',
        createdAt: 2
      }
    ];
    activeSession = updated;
    sessions.set(updated.id, updated);
    await act(async () => {
      runtimeListener?.({
        type: 'capture-agent-sessions-changed',
        sessionId: updated.id
      });
    });

    const jump = await screen.findByRole('button', { name: '新回复' });
    expect(screen.getByRole('tab', { name: /过程/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    fireEvent.click(jump);
    expect(screen.getByRole('tab', { name: /对话/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('Agent 已经完成新的目录比较。')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '新回复' })
    ).not.toBeInTheDocument();
  });

  it('keeps approval unavailable while the Agent is adjusting', async () => {
    const adjusting = cloneSession();
    adjusting.state = 'adjusting';
    activeSession = adjusting;
    sessions.set(adjusting.id, adjusting);
    render(<App />);

    expect(await screen.findByText('正在调整')).toBeVisible();
    expect(screen.getByRole('button', { name: '调整中' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: '告诉 Agent 怎么改' })
    ).toBeEnabled();
  });

  it('shows explicit empty and load-error states', async () => {
    activeSession = null;
    sessions.clear();
    const { unmount } = render(<App />);
    expect(await screen.findByText('没有进行中的收藏')).toBeVisible();
    unmount();

    sendMessage.mockRejectedValueOnce(new Error('本地存储暂不可用'));
    render(<App />);
    expect(await screen.findByText('暂时无法读取任务')).toBeVisible();
    expect(screen.getByText('本地存储暂不可用')).toBeVisible();
    activeSession = cloneSession();
    sessions.set(activeSession.id, activeSession);
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(screen.getByText('正在读取收藏任务')).toBeVisible();
    expect(await screen.findByText('更清晰的页面标题')).toBeVisible();
  });

  it('keeps every activity status glyph mounted for stable transitions', async () => {
    const { container } = render(<App />);

    await waitFor(() =>
      expect(container.querySelectorAll('.analysis-trace li')).toHaveLength(3)
    );
    for (const item of container.querySelectorAll('.analysis-trace li')) {
      expect(item.querySelectorAll('[data-glyph]')).toHaveLength(4);
      expect(
        item.querySelector('[data-glyph="pending-skipped"]')
      ).toBeInTheDocument();
    }
  });

  function actionRequests() {
    return sendMessage.mock.calls
      .map(([request]) => request as RuntimeRequest)
      .filter((request) => request.type === 'capture-agent-action');
  }
});
