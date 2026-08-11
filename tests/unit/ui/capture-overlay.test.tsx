import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CaptureOverlay } from '../../../src/ui/content/CaptureOverlay';

describe('CaptureOverlay', () => {
  it('shows a risky destination and asks for a simple decision', () => {
    const onAction = vi.fn();
    render(
      <CaptureOverlay
        view={{
          sessionId: 'session-1',
          phase: 'approval',
          destinationPath: ['书签栏', '开发', 'AI'],
          newFolderName: 'Agent',
          title: '浏览器收藏 Agent 设计'
        }}
        onAction={onAction}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('开发');
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('浏览器收藏 Agent 设计')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '允许' }));
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    fireEvent.click(screen.getByRole('button', { name: '与 Agent 调整' }));

    expect(onAction.mock.calls).toEqual([
      ['allow'],
      ['reject'],
      ['adjust']
    ]);
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
