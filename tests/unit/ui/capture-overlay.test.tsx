import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureOverlay } from '../../../src/ui/content/CaptureOverlay';

describe('CaptureOverlay', () => {
  afterEach(cleanup);

  it('shows live analysis steps while Ctrl+D processing is in progress', () => {
    render(
      <CaptureOverlay
        view={{
          sessionId: 'session-1',
          phase: 'processing',
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
              id: 'model-analysis',
              kind: 'model',
              status: 'running',
              label: 'AI 正在生成归类方案',
              createdAt: 2,
              updatedAt: 2
            }
          ]
        }}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('原生书签已保存');
    expect(screen.getByRole('status')).toHaveTextContent('AI 正在生成归类方案');
    expect(screen.getByText(/书签已保存 · 正在分析/)).toBeVisible();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '分析过程' })).not.toBeVisible();

    fireEvent.click(screen.getByText('分析过程'));
    expect(screen.getByRole('list', { name: '分析过程' })).toBeVisible();
  });

  it('keeps the bookmark-saved guarantee visible when enhancement steps are added', () => {
    const activities = [
      ['capture', 'capture', '原生书签已保存'],
      ['page-context', 'page', '页面上下文已准备'],
      ['folders', 'folders', '已比较候选目录'],
      ['vision', 'vision', '正在识别页面截图'],
      ['web-search', 'web-search', '正在请求联网搜索'],
      ['model', 'model', 'AI 正在生成归类方案']
    ] as const;

    render(
      <CaptureOverlay
        view={{
          phase: 'processing',
          activities: activities.map(([id, kind, label], index) => ({
            id,
            kind,
            status: index === activities.length - 1 ? 'running' : 'completed',
            label,
            createdAt: index,
            updatedAt: index
          }))
        }}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('原生书签已保存');
    expect(status).toHaveTextContent('正在识别页面截图');
    expect(status).toHaveTextContent('正在请求联网搜索');
    expect(status).toHaveTextContent('AI 正在生成归类方案');
    expect(screen.getByText(/书签已保存 · 正在分析/)).toBeVisible();
    expect(screen.getByText(/5 \/ 6/)).toBeInTheDocument();
  });

  it('features the latest running activity when analysis runs in parallel', () => {
    render(
      <CaptureOverlay
        view={{
          phase: 'processing',
          activities: [
            {
              id: 'vision',
              kind: 'vision',
              status: 'running',
              label: '正在识别页面截图',
              createdAt: 1,
              updatedAt: 1
            },
            {
              id: 'web-search',
              kind: 'web-search',
              status: 'running',
              label: '正在联网搜索',
              createdAt: 2,
              updatedAt: 2
            },
            {
              id: 'model',
              kind: 'model',
              status: 'running',
              label: 'AI 正在综合判断',
              createdAt: 3,
              updatedAt: 3
            }
          ]
        }}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(
      screen.getByText('AI 正在综合判断', {
        selector: '.siftmark-trace-summary-copy strong'
      })
    ).toBeVisible();
  });

  it('shows a risky destination and asks for a simple decision', () => {
    const onAction = vi.fn();
    render(
      <CaptureOverlay
        view={{
          sessionId: 'session-1',
          phase: 'approval',
          destinationPath: ['书签栏', '开发', 'AI'],
          newFolderNames: ['Agent', '研究'],
          title: '浏览器收藏 Agent 设计',
          activities: [
            {
              id: 'risk-check',
              kind: 'risk',
              status: 'completed',
              label: '风险检查完成',
              facts: [
                { label: '命中规则', value: '新建目录' },
                { label: '审批结论', value: '风险方案，需要用户批准' }
              ],
              createdAt: 1,
              updatedAt: 21,
              durationMs: 20
            }
          ]
        }}
        onAction={onAction}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('开发');
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('研究')).toBeInTheDocument();
    expect(screen.getAllByText('新建')).toHaveLength(2);
    expect(screen.getByText('浏览器收藏 Agent 设计')).toBeInTheDocument();
    expect(screen.getByText('命中规则')).not.toBeVisible();
    expect(screen.getByText('风险方案，需要用户批准')).not.toBeVisible();

    fireEvent.click(screen.getByText('分析过程'));
    expect(screen.getByText('命中规则')).toBeVisible();
    expect(screen.getByText('风险方案，需要用户批准')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '允许' }));
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    fireEvent.click(screen.getByRole('button', { name: '与 Agent 调整' }));

    expect(onAction.mock.calls).toEqual([['allow'], ['reject'], ['adjust']]);
  });

  it('offers undo and adjustment after automatic organization', () => {
    const onAction = vi.fn();
    render(
      <CaptureOverlay
        view={{
          phase: 'saved',
          destinationPath: ['书签栏', '产品'],
          canUndo: true,
          canAdjust: true
        }}
        onAction={onAction}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('收藏已放好');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '调整' }));
    expect(onAction.mock.calls).toEqual([['undo'], ['adjust']]);
  });

  it('keeps failure copy explicit and exposes retry', () => {
    const onAction = vi.fn();
    render(
      <CaptureOverlay
        view={{
          phase: 'error',
          message: '网络连接失败，收藏仍在原位置。'
        }}
        onAction={onAction}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('收藏已保留原位');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onAction).toHaveBeenCalledWith('retry');
  });
});
