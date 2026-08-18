import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureSession } from '../../../src/capture-agent';
import { AgentHistorySection } from '../../../src/ui/options/AgentHistorySection';

describe('AgentHistorySection', () => {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const createTab = vi.fn();
  const confirm = vi.fn().mockReturnValue(true);

  beforeEach(() => {
    sendMessage.mockClear();
    createTab.mockClear();
    confirm.mockClear();
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      tabs: { create: createTab }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows preserved dialogue, analysis, route, and allows ended record deletion', async () => {
    const applied = session();
    const repository = repositoryFor([applied]);
    render(<AgentHistorySection repository={repository as never} />);

    const summary = await screen.findByText('Agent 收藏记录');
    fireEvent.click(summary.closest('summary')!);

    expect(screen.getByText('放到开发目录')).toBeVisible();
    expect(screen.getByText('已按你的要求调整')).toBeVisible();
    expect(screen.getByText('AI 已生成归类方案')).toBeVisible();
    expect(screen.getAllByText('开发 / AI').length).toBeGreaterThan(0);
    expect(screen.getByText('已采用 开发 / AI（3 个结果）')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }));
    await waitFor(() =>
      expect(repository.removeEnded).toHaveBeenCalledWith(applied.id)
    );
  });

  it('keeps failed retryable sessions visible but not removable', async () => {
    const failed = session({
      id: 'failed',
      state: 'failed',
      resolution: undefined,
      failure: {
        kind: 'network',
        message: 'Provider request aborted',
        retryable: true,
        retryCount: 2
      }
    });
    const repository = repositoryFor([failed]);
    render(<AgentHistorySection repository={repository as never} />);

    const summary = await screen.findByText('Agent 收藏记录');
    fireEvent.click(summary.closest('summary')!);

    expect(screen.getByText(/Provider request aborted/)).toBeVisible();
    expect(screen.getByText('进行中或可重试的任务不能清理')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '删除记录' })
    ).not.toBeInTheDocument();
  });

  it('explains avoided memories and keeps adopted entries visible after the first three', async () => {
    const applied = session({
      plan: {
        ...session().plan!,
        memoryInfluence: {
          matched: [
            ...Array.from({ length: 3 }, (_, index) => ({
              id: `memory-${index}`,
              domain: 'example.test',
              action: 'prefer-folder' as const,
              destinationPath: ['开发', `Folder ${index}`],
              evidenceCount: 1,
              confidence: 'medium' as const,
              reviewSummary: ''
            })),
            {
              id: 'avoided-memory',
              domain: 'example.test',
              action: 'avoid-folder' as const,
              destinationPath: ['广告'],
              evidenceCount: 4,
              confidence: 'high' as const,
              reviewSummary: ''
            }
          ],
          adoptedMemoryIds: ['avoided-memory']
        }
      }
    });
    const repository = repositoryFor([applied]);
    render(<AgentHistorySection repository={repository as never} />);

    fireEvent.click((await screen.findByText('Agent 收藏记录')).closest('summary')!);

    expect(screen.getByText(/已避开 广告（4 个结果）/)).toBeVisible();
    expect(screen.getByText(/其余 1 条未展开/)).toBeVisible();
  });
});

function repositoryFor(sessions: CaptureSession[]) {
  return {
    list: vi.fn().mockResolvedValue(sessions),
    count: vi.fn().mockResolvedValue(sessions.length),
    countEnded: vi.fn().mockResolvedValue(sessions.length),
    clearEnded: vi.fn().mockResolvedValue(sessions.length),
    removeEnded: vi.fn().mockResolvedValue(true)
  };
}

function session(patch: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: 'session',
    bookmarkId: 'bookmark',
    trigger: 'native-bookmark',
    sourceSnapshot: {
      id: 'bookmark',
      parentId: 'inbox',
      index: 0,
      title: '原始标题',
      url: 'https://example.test/docs'
    },
    state: 'applied',
    resolution: 'allowed',
    plan: {
      destination: {
        folderId: 'ai',
        path: [
          { id: 'dev', title: '开发' },
          { id: 'ai', title: 'AI' }
        ],
        newFolders: []
      },
      title: 'Agent 收藏记录',
      tags: [],
      summary: '测试记录',
      confidence: 'high',
      reason: '内容与 AI 开发相关',
      relatedBookmarks: [],
      generatedAt: 1,
      memoryInfluence: {
        matched: [
          {
            id: 'sleep-review:example.test',
            domain: 'example.test',
            action: 'prefer-folder',
            destinationPath: ['开发', 'AI'],
            evidenceCount: 3,
            confidence: 'high',
            reviewSummary: '连续归入开发 / AI'
          }
        ],
        adoptedMemoryIds: ['sleep-review:example.test']
      }
    },
    messages: [
      { id: 'user', role: 'user', text: '放到开发目录', createdAt: 2 },
      {
        id: 'assistant',
        role: 'assistant',
        text: '已按你的要求调整',
        createdAt: 3
      }
    ],
    activities: [
      {
        id: 'model',
        kind: 'model',
        status: 'completed',
        label: 'AI 已生成归类方案',
        createdAt: 1,
        updatedAt: 2
      }
    ],
    createdAt: 1,
    updatedAt: 3,
    expiresAt: 100,
    resolvedAt: 3,
    ...patch
  };
}
