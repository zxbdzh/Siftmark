import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelProfile } from '../../../src/ai/types';
import { ModelProfilesSection } from '../../../src/ui/options/ModelProfilesSection';

const verifiedProfile: ModelProfile = {
  id: 'p',
  version: 'v1',
  name: 'P',
  protocol: 'openai-chat',
  endpoint: 'https://a.test',
  model: 'm',
  apiKey: 'secret',
  timeoutMs: 10_000,
  capabilities: ['classify'],
  state: 'verified'
};

afterEach(cleanup);

describe('ModelProfilesSection', () => {
  it('masks stored keys and labels drafts', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([{ ...verifiedProfile, state: 'draft' }])
    };

    render(<ModelProfilesSection repository={repository as never} />);

    await user.click(await screen.findByText('P'));
    expect(await screen.findByText(/Key 已配置/)).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveAttribute(
      'type',
      'password'
    );
  });

  it('filters model cards by model id', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([
        verifiedProfile,
        {
          ...verifiedProfile,
          id: 'other',
          name: 'Other',
          model: 'other-model'
        }
      ])
    };

    render(<ModelProfilesSection repository={repository as never} />);

    const search = await screen.findByPlaceholderText(
      '搜索名称、模型 ID、Endpoint…'
    );
    await user.type(search, 'other-model');

    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.queryByText('P')).not.toBeInTheDocument();
  });

  it('assigns a verified classification model only to the capture Agent', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([verifiedProfile])
    };
    const service = {
      getAssignments: vi
        .fn()
        .mockResolvedValueOnce({ classify: 'p@v1' })
        .mockResolvedValue({ classify: 'p@v1', agent: 'p@v1' }),
      assign: vi.fn().mockResolvedValue(undefined),
      unassign: vi.fn().mockResolvedValue(undefined)
    };

    const { container } = render(
      <ModelProfilesSection
        repository={repository as never}
        service={service as never}
      />
    );

    const select = await screen.findByLabelText('收藏 Agent');
    await user.selectOptions(select, 'p@v1');

    expect(service.assign).toHaveBeenCalledWith(verifiedProfile, ['agent']);
    expect(
      within(container.querySelector('.ai-assignment-panel')!).getByLabelText(
        '分类'
      )
    ).toHaveValue('p@v1');
  });

  it('creates two models from one preset without replacing the first or carrying its key', async () => {
    const user = userEvent.setup();
    const stored: ModelProfile[] = [];
    const repository = {
      list: vi.fn(async () => [...stored]),
      put: vi.fn(async (profile: ModelProfile) => {
        stored.push(profile);
        return profile;
      })
    };
    render(<ModelProfilesSection repository={repository as never} />);
    for (let index = 0; index < 2; index += 1) {
      await user.click(await screen.findByRole('button', { name: '新建' }));
      expect(screen.getByLabelText('服务商预设')).toHaveValue('');
      await user.type(screen.getByLabelText('API Key'), 'old-provider-key');
      await user.selectOptions(screen.getByLabelText('服务商预设'), 'deepseek');
      expect(screen.getByLabelText('API Key')).toHaveValue('');
      await user.click(screen.getByRole('button', { name: '保存草稿' }));
      expect(screen.getByText('草稿已保存，尚未验证')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '关闭模型编辑' }));
    }
    expect(stored).toHaveLength(2);
    expect(stored[0]!.id).not.toBe(stored[1]!.id);
    expect(stored.every((profile) => profile.id !== 'deepseek')).toBe(true);
  });

  it('keeps verification and task assignment when only the name changes', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([verifiedProfile]),
      put: vi.fn(async (profile: ModelProfile) => profile)
    };
    const service = {
      getAssignments: vi.fn().mockResolvedValue({ classify: 'p@v1' })
    };
    render(
      <ModelProfilesSection
        repository={repository as never}
        service={service as never}
      />
    );
    await user.click(await screen.findByText('P'));
    await user.click(screen.getByRole('button', { name: '保存配置' }));
    expect(repository.put).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'verified' })
    );
    await user.clear(screen.getByLabelText('名称'));
    await user.type(screen.getByLabelText('名称'), 'Renamed');
    await user.click(screen.getByRole('button', { name: '保存配置' }));
    expect(repository.put).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Renamed', state: 'verified' })
    );
    expect(screen.getByLabelText('分类', { selector: 'select' })).toHaveValue(
      'p@v1'
    );
  });

  it('does not replace a usable profile when edited connection verification fails', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([verifiedProfile]),
      put: vi.fn()
    };
    const service = {
      getAssignments: vi.fn().mockResolvedValue({ classify: 'p@v1' }),
      verify: vi.fn().mockRejectedValue(new Error('HTTP 401'))
    };
    render(
      <ModelProfilesSection
        repository={repository as never}
        service={service as never}
      />
    );
    await user.click(await screen.findByText('P'));
    await user.clear(screen.getByLabelText('模型', { selector: 'input' }));
    await user.type(
      screen.getByLabelText('模型', { selector: 'input' }),
      'changed'
    );
    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '设为所选任务默认' })
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '验证并保存' }));
    expect(
      await screen.findByText(/验证失败：HTTP 401；未保存修改/)
    ).toBeInTheDocument();
    expect(repository.put).not.toHaveBeenCalled();
    expect(service.verify).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'changed', state: 'draft' }),
      expect.any(AbortSignal)
    );
    expect(screen.getByLabelText('分类', { selector: 'select' })).toHaveValue(
      'p@v1'
    );
  });

  it('cancels verification when the editor closes without changing saved configuration', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([verifiedProfile]),
      put: vi.fn()
    };
    const service = {
      getAssignments: vi.fn().mockResolvedValue({ classify: 'p@v1' }),
      verify: vi.fn(
        (_profile: ModelProfile, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('Cancelled', 'AbortError')),
              { once: true }
            );
          })
      )
    };
    render(
      <ModelProfilesSection
        repository={repository as never}
        service={service as never}
      />
    );
    await user.click(await screen.findByText('P'));
    await user.click(screen.getByRole('button', { name: '验证并保存' }));
    expect(screen.getByLabelText('名称')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '关闭模型编辑' }));
    expect(service.verify.mock.calls[0]![1].aborted).toBe(true);
    expect(repository.put).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '新建' }));
    expect(screen.getByLabelText('名称')).not.toBeDisabled();
    expect(screen.queryByText(/验证失败/)).not.toBeInTheDocument();
  });

  it('ignores a delayed native close event after opening a new editing session', async () => {
    const user = userEvent.setup();
    const repository = { list: vi.fn().mockResolvedValue([verifiedProfile]) };
    render(<ModelProfilesSection repository={repository as never} />);
    await user.click(await screen.findByText('P'));
    await user.click(screen.getByRole('button', { name: '关闭模型编辑' }));
    await user.click(screen.getByRole('button', { name: '新建' }));
    const dialog = screen.getByRole('dialog', { name: '新建模型' });
    fireEvent(dialog, new Event('close'));
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByLabelText('名称')).toHaveValue('自定义模型');
  });
});
