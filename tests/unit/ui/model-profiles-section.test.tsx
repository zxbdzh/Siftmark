import { cleanup, render, screen, within } from '@testing-library/react';
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
    const repository = {
      list: vi.fn().mockResolvedValue([{ ...verifiedProfile, state: 'draft' }])
    };

    render(<ModelProfilesSection repository={repository as never} />);

    expect(await screen.findByText(/••••••/)).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
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
});
