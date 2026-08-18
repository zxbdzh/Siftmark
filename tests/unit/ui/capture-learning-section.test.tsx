import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureLearningMemory } from '../../../src/capture-agent';
import { CaptureLearningSection } from '../../../src/ui/options/CaptureLearningSection';

const memory: CaptureLearningMemory = {
  id: 'sleep-review:example.test',
  kind: 'learned',
  domain: 'example.test',
  action: 'prefer-folder',
  destinationPath: ['开发', 'AI'],
  source: 'sleep-review',
  sourceSessionId: 'session',
  reviewSummary: '连续批准归入开发 / AI',
  evidenceCount: 3,
  confidence: 'high',
  reviewedAt: 100,
  createdAt: 100,
  updatedAt: 100
};

describe('CaptureLearningSection', () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockResolvedValue({ summary: '本次回顾完成' });
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('explains metered idle review and lets the user inspect or remove memory', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([memory]),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(1)
    };
    const settings = {
      getSleepReviewSettings: vi.fn().mockResolvedValue({
        enabled: true,
        idleMinutes: 15,
        batchSize: 8
      }),
      getSleepReviewStatus: vi.fn().mockResolvedValue({
        state: 'learned',
        summary: '从 3 个结果中整理出 1 条记忆'
      }),
      setSleepReviewSettings: vi.fn().mockResolvedValue(undefined)
    };

    render(
      <CaptureLearningSection
        repository={repository as never}
        settingsRepository={settings as never}
      />
    );

    expect(await screen.findByText('example.test')).toBeInTheDocument();
    expect(screen.getByText('连续批准归入开发 / AI')).toBeInTheDocument();
    expect(
      screen.getByText(/使用你配置的 Agent 模型和额度/)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看采用记录' })).toHaveAttribute(
      'href',
      '#agent'
    );

    const toggle = screen.getByRole('checkbox', {
      name: /空闲时自动回顾/
    });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();

    await user.click(screen.getByRole('button', { name: '现在回顾' }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'capture-learning-review-now'
      })
    );

    await user.click(
      screen.getByRole('button', {
        name: '删除 example.test 的学习记忆'
      })
    );
    expect(repository.remove).toHaveBeenCalledWith(memory.id);
  });

  it('keeps manual review failures visible and actionable', async () => {
    const user = userEvent.setup();
    sendMessage.mockRejectedValueOnce(new Error('后台 Agent 暂时不可用'));
    const repository = {
      list: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
      clear: vi.fn()
    };
    const settings = {
      getSleepReviewSettings: vi.fn().mockResolvedValue({
        enabled: true,
        idleMinutes: 15,
        batchSize: 8
      }),
      getSleepReviewStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
      setSleepReviewSettings: vi.fn().mockResolvedValue(undefined)
    };

    render(
      <CaptureLearningSection
        repository={repository as never}
        settingsRepository={settings as never}
      />
    );

    const review = screen.getByRole('button', { name: '现在回顾' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);

    expect(
      await screen.findByText('回顾未完成：后台 Agent 暂时不可用')
    ).toBeInTheDocument();
    expect(review).toBeEnabled();
  });
});
