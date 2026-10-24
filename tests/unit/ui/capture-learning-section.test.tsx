import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureLearningSection } from '../../../src/ui/options/CaptureLearningSection';

const memory = { id: 'memory', kind: 'learned', domain: 'example.test', action: 'prefer-folder', destinationFolderId: 'a', destinationPath: ['开发'], source: 'local-feedback', sourceSessionId: 'capture:one', sourceEventIds: ['capture:one', 'capture:two'], reviewSummary: '两个不同书签的确认一致', evidenceCount: 2, confidence: 'medium', reviewedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() };
function setup() {
  const snapshot = { configuration: { enabled: true, proactive: false }, memories: [memory], evidenceCount: 2,
    folders: [{ id: 'a', title: '开发' }, { id: 'b', title: '研究' }], plans: [] };
  const experiences = { inspect: vi.fn(async () => snapshot), configure: vi.fn(async (enabled, proactive) => { snapshot.configuration = { enabled, proactive }; }),
    correct: vi.fn(), forget: vi.fn(), clear: vi.fn(), review: vi.fn().mockResolvedValue({ summary: '本地复盘完成，没有移动书签' }) };
  const settings = { getSleepReviewSettings: vi.fn().mockResolvedValue({ enabled: false, idleMinutes: 15, batchSize: 8 }), setSleepReviewSettings: vi.fn() };
  render(<CaptureLearningSection settingsRepository={settings as never} experiences={experiences as never} />);
  return { experiences, settings };
}
beforeEach(() => vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn().mockResolvedValue({ summary: '本地复盘完成，没有移动书签' }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CaptureLearningSection', () => {
  it('shows provenance, supports explicit correction and deletion, and explains local privacy', async () => {
    const user = userEvent.setup(); const { experiences } = setup();
    expect(await screen.findByText('example.test')).toBeInTheDocument();
    expect(screen.getByText(/学习记录不发送给模型/)).toBeInTheDocument();
    await user.click(screen.getByText('查看来源与纠正'));
    expect(screen.getByText(/capture:one、capture:two/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('纠正 example.test 的目录'), 'b');
    await user.click(screen.getByRole('button', { name: '保存纠正' }));
    expect(experiences.correct).toHaveBeenCalledWith('memory', 'b', 'prefer-folder');
    await user.click(screen.getByRole('button', { name: '删除 example.test 的学习记忆' }));
    expect(experiences.forget).toHaveBeenCalledWith('memory');
  });

  it('immediately persists pause and prevents further review', async () => {
    const user = userEvent.setup(); const { experiences } = setup();
    const toggle = await screen.findByRole('checkbox', { name: /^本地学习/ });
    expect(toggle).toBeChecked(); await user.click(toggle);
    await waitFor(() => expect(experiences.configure).toHaveBeenCalledWith(false, false));
    expect(screen.getByRole('button', { name: '现在回顾' })).toBeDisabled();
    expect(await screen.findByText(/不再积累证据/)).toBeInTheDocument();
  });

  it('keeps failed reflection actionable and clears learning data only after confirmation', async () => {
    const user = userEvent.setup(); const { experiences } = setup();
    vi.mocked(browser.runtime.sendMessage).mockRejectedValueOnce(new Error('本地数据库暂时不可用'));
    const review = await screen.findByRole('button', { name: '现在回顾' });
    await waitFor(() => expect(review).toBeEnabled()); await user.click(review);
    expect(await screen.findByText('操作未完成：本地数据库暂时不可用')).toBeInTheDocument();
    expect(review).toBeEnabled();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: '清空学习数据' })); expect(experiences.clear).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '清空学习数据' })); expect(experiences.clear).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});
