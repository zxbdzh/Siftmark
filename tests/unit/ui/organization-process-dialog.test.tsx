import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationProcessDialog,
  organizeProgressText
} from '../../../src/ui/manager/OrganizationProcessDialog';
import type { OrganizeProgress } from '../../../src/bookmarks/organize-bookmarks';

const preview: OrganizeProgress = {
  stage: 'preview',
  total: 2,
  completed: 0,
  failed: 0,
  skipped: 3,
  createdFolders: 0,
  read: 2,
  assigned: 2,
  startedAt: 1,
  stageStartedAt: Date.now(),
  currentTitle: '',
  backupFilename: 'backup.html',
  errors: [],
  moveCount: 2,
  newFolderPaths: [['开发'], ['开发', '前端']],
  folders: [{ path: ['开发', '前端'], purpose: '前端文档' }],
  items: ['a', 'b'].map((id) => ({
    bookmarkId: id,
    title: id,
    url: `https://${id}.test`,
    sourceFolderPath: ['旧分类'],
    status: 'pending',
    selectedFolderPath: ['开发', '前端'],
    confidence: 'high',
    summary: '开发文档',
    reason: '用途相近'
  }))
};

afterEach(cleanup);

describe('OrganizationProcessDialog', () => {
  it('shows the whole taxonomy first, including parent counts, and requires explicit approval', () => {
    const confirm = vi.fn();
    render(
      <OrganizationProcessDialog
        progress={preview}
        onClose={vi.fn()}
        onConfirm={confirm}
      />
    );
    expect(screen.getByRole('tab', { name: '分类方案' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('2 条')).toHaveLength(2);
    expect(screen.getByText('尚未改动')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并移动 2 条' }));
    expect(confirm).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '取消，不移动' }));
    expect(confirm).toHaveBeenLastCalledWith(false);
  });

  it('shows discarded similarity suggestions without blocking a valid classification preview', () => {
    render(
      <OrganizationProcessDialog
        progress={{
          ...preview,
          batches: [
            {
              id: 'reviewing-1',
              stage: 'reviewing',
              batch: 1,
              count: 4,
              status: 'completed',
              attempt: 1,
              ignoredSimilarities: 4
            }
          ]
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByText('4 条相似建议未通过校验，已忽略；不会据此回收书签。')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '确认并移动 2 条' })
    ).toBeEnabled();
  });

  it('opens bookmarks for the selected category and labels confidence as model self-evaluation', () => {
    render(
      <OrganizationProcessDialog
        progress={preview}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /前端文档/ }));
    expect(screen.getByRole('tab', { name: '书签明细 · 2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('模型自评：较确定')).toBeInTheDocument();
    expect(screen.getByText('未执行移动')).toBeInTheDocument();
    expect(screen.getByText('开发 / 前端 · 2')).toBeInTheDocument();
  });

  it('keeps completed stages after planning fails and does not claim the task is still running', () => {
    render(
      <OrganizationProcessDialog
        progress={{
          ...preview,
          stage: 'failed',
          stoppedStage: 'assigning',
          pipelineError: '归属不完整'
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    const stages = screen
      .getByRole('list', { name: '整理流水线' })
      .querySelectorAll('li');
    expect(stages[0]).toHaveAttribute('data-state', 'completed');
    expect(stages[1]).toHaveAttribute('data-state', 'completed');
    expect(stages[2]).toHaveAttribute('data-state', 'failed');
    expect(screen.getByText('已停止')).toBeInTheDocument();
    expect(screen.queryByText('规划中')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).getAllByText('未执行')
    ).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: /确认并移动/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('归属不完整');
    const retry = vi.fn();
    cleanup();
    render(
      <OrganizationProcessDialog
        progress={{
          ...preview,
          stage: 'failed',
          stoppedStage: 'assigning',
          pipelineError: '模型请求超时'
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onRetry={retry}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    expect(retry).toHaveBeenCalledOnce();
    cleanup();
    const retryFailed = vi.fn();
    render(
      <OrganizationProcessDialog
        progress={{
          ...preview,
          stage: 'failed',
          stoppedStage: 'planning',
          pipelineError: '模型请求超时',
          batches: [
            {
              id: 'reading-1',
              stage: 'reading',
              batch: 1,
              count: 80,
              status: 'completed',
              attempt: 1,
              summary: '开发文档'
            },
            {
              id: 'planning-1',
              stage: 'planning',
              batch: 1,
              count: 0,
              status: 'failed',
              attempt: 3,
              error: '模型请求超时'
            }
          ]
        }}
        model={{
          id: 'm',
          version: '1',
          name: 'sylorapi',
          protocol: 'openai-responses',
          endpoint: 'https://api.test',
          model: 'grok-4.7',
          apiKey: 'secret-key',
          timeoutMs: 120000,
          capabilities: ['classify'],
          state: 'verified'
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onRetry={vi.fn()}
        onRetryFailed={retryFailed}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '重试失败批次' }));
    expect(retryFailed).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '复制诊断' }));
    const diagnostic = screen.getByLabelText('整理诊断');
    const text = (diagnostic as HTMLTextAreaElement).value;
    expect(text).toContain('模型请求超时');
    expect(text).toContain('sylorapi / grok-4.7');
    expect(text).not.toContain('secret-key');
  });

  it('shows a real batch and elapsed wait instead of a made-up percentage', () => {
    const progress: OrganizeProgress = {
      ...preview,
      stage: 'reading',
      read: 0,
      batch: 1,
      batchTotal: 2
    };
    expect(organizeProgressText(progress)).toContain('第 1 / 2 批');
    render(
      <OrganizationProcessDialog
        progress={progress}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText(/等待模型返回 · 当前阶段已用/)).toBeInTheDocument();
  });

  it('moves focus and selection between views with the keyboard', () => {
    render(
      <OrganizationProcessDialog
        progress={preview}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    const taxonomy = screen.getByRole('tab', { name: '分类方案' });
    fireEvent.keyDown(taxonomy, { key: 'ArrowRight' });
    const items = screen.getByRole('tab', { name: '书签明细 · 2' });
    expect(items).toHaveFocus();
    expect(items).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(items, { key: 'Home' });
    const activity = screen.getByRole('tab', { name: '分析过程' });
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-selected', 'true');
  });
  it('lets a user select the keeper before approving duplicate recycling', () => {
    const confirm = vi.fn();
    render(
      <OrganizationProcessDialog
        progress={{
          ...preview,
          duplicates: [
            {
              id: 'a',
              url: 'https://same.test/',
              keepBookmarkId: 'a',
              bookmarks: [
                {
                  id: 'a',
                  title: '原始收藏',
                  url: 'https://same.test/',
                  parentId: 'old',
                  index: 0,
                  dateAdded: 1
                },
                {
                  id: 'copy',
                  title: '更新标题',
                  url: 'https://same.test/',
                  parentId: 'old',
                  index: 1,
                  dateAdded: 2
                }
              ]
            }
          ]
        }}
        onClose={vi.fn()}
        onConfirm={confirm}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /同 URL 重复/ }));
    fireEvent.click(screen.getByRole('radio', { name: /更新标题/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认并移动/ }));
    expect(confirm).toHaveBeenCalledWith({
      approved: true,
      keepBookmarkIds: { a: 'copy' }
    });
  });
});
