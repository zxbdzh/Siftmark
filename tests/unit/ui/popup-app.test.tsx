import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { relativeTime } from '../../../entrypoints/popup/App';
import type { CaptureSession } from '../../../src/capture-agent';

const pendingSession: CaptureSession = {
  id: 'session-pending',
  bookmarkId: 'bookmark-pending',
  trigger: 'native-bookmark',
  sourceSnapshot: {
    id: 'bookmark-pending',
    parentId: 'inbox',
    index: 0,
    title: '原始页面标题',
    url: 'https://example.com/article'
  },
  state: 'pending',
  plan: {
    destination: {
      folderId: 'development',
      path: [
        { id: 'root', title: '知识库' },
        { id: 'development', title: '开发' }
      ],
      newFolders: ['Agent']
    },
    title: '浏览器收藏 Agent',
    tags: ['AI'],
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
    }
  ],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  expiresAt: Date.now() + 60_000
};

const appliedSession: CaptureSession = {
  ...pendingSession,
  id: 'session-applied',
  bookmarkId: 'bookmark-applied',
  state: 'applied',
  resolution: 'allowed',
  operationBatchId: 'operation-1',
  updatedAt: Date.now()
};

describe('Popup Agent queue', () => {
  const sendMessage = vi.fn();
  const createTab = vi.fn();
  const confirm = vi.fn();
  let sessions: CaptureSession[];

  beforeEach(() => {
    sessions = [pendingSession];
    sendMessage.mockReset();
    createTab.mockReset();
    confirm.mockReset();
    confirm.mockReturnValue(true);
    sendMessage.mockImplementation(
      async (request: {
        type: string;
        input?: { sessionId: string; action: string };
      }) => {
        if (request.type === 'capture-agent-list') return sessions;
        if (request.type === 'capture-agent-count-ended')
          return sessions.filter(
            (session) => !['pending', 'failed'].includes(session.state)
          ).length;
        if (request.type === 'capture-agent-clear-ended') {
          const previous = sessions.length;
          sessions = sessions.filter((session) =>
            ['pending', 'failed'].includes(session.state)
          );
          return { success: true, count: previous - sessions.length };
        }
        if (request.type === 'capture-agent-action') {
          return {
            success: true,
            session: sessions.find(
              (session) => session.id === request.input?.sessionId
            )
          };
        }
        return null;
      }
    );
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage,
        getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
        openOptionsPage: vi.fn(),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      tabs: { create: createTab }
    });
    vi.stubGlobal('confirm', confirm);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the task view for an approval and shows its full route', async () => {
    const { container } = render(<App />);

    const taskTab = await screen.findByRole('tab', { name: /任务/ });
    expect(taskTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /回执/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    const lane = screen.getByRole('list', { name: '收藏处理进度' });
    expect(within(lane).getByText('已保存').closest('li')).toHaveAttribute(
      'data-state',
      'done'
    );
    expect(within(lane).getByText('AI 整理').closest('li')).toHaveAttribute(
      'data-state',
      'done'
    );
    expect(within(lane).getByText('待批准').closest('li')).toHaveAttribute(
      'data-state',
      'current'
    );

    const route = container.querySelector('.task-route');
    expect(route).toHaveTextContent('知识库');
    expect(route).toHaveTextContent('开发');
    expect(route).toHaveTextContent('Agent');
    expect(screen.getByRole('button', { name: '拒绝' })).toBeVisible();
    expect(screen.getByRole('button', { name: '允许' })).toBeVisible();
  });

  it('sends the secondary adjustment action to the capture Agent', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '调整方案' }));

    await waitFor(() =>
      expect(actionRequests()).toContainEqual(
        expect.objectContaining({
          input: { sessionId: pendingSession.id, action: 'adjust' }
        })
      )
    );
  });

  it('opens receipts when there are no active tasks and keeps undo available', async () => {
    sessions = [appliedSession];
    render(<App />);

    const receiptsTab = await screen.findByRole('tab', { name: /回执/ });
    expect(receiptsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('浏览器收藏 Agent')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: '撤销 浏览器收藏 Agent' })
    );
    await waitFor(() =>
      expect(actionRequests()).toContainEqual(
        expect.objectContaining({
          input: { sessionId: appliedSession.id, action: 'undo' }
        })
      )
    );
  });

  it('formats receipt timestamps from seconds through calendar dates', () => {
    const now = new Date(2025, 6, 8, 12).getTime();
    const olderDate = new Date(2025, 6, 6, 12).getTime();

    expect(relativeTime(now - 30_000, now)).toBe('刚刚');
    expect(relativeTime(now - 17 * 60_000, now)).toBe('17 分钟前');
    expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe('3 小时前');
    expect(relativeTime(olderDate, now)).toBe(
      new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric'
      }).format(olderDate)
    );
  });

  it('ends failed work and keeps it outside bulk record cleanup until then', async () => {
    const failed: CaptureSession = {
      ...pendingSession,
      id: 'session-failed',
      state: 'failed',
      failure: {
        kind: 'network',
        message: 'Provider request aborted',
        retryable: true,
        retryCount: 1
      }
    };
    sessions = [failed];
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '结束任务' }));

    await waitFor(() =>
      expect(actionRequests()).toContainEqual(
        expect.objectContaining({
          input: { sessionId: failed.id, action: 'end' }
        })
      )
    );
  });

  it('confirms the exact ended record count before bulk cleanup', async () => {
    sessions = [appliedSession];
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: '清理记录' })
    );

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining('清理 1 条已结束的 Agent 记录')
      )
    );
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'capture-agent-clear-ended'
    });
    expect(await screen.findByText('已清理 1 条记录')).toBeVisible();
  });

  function actionRequests() {
    return sendMessage.mock.calls
      .map(([request]) => request as { type?: string; input?: unknown })
      .filter((request) => request.type === 'capture-agent-action');
  }
});
