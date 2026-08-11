import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CapturePreference } from '../../../src/capture-agent';
import { CapturePreferencesSection } from '../../../src/ui/options/CapturePreferencesSection';

const rule: CapturePreference = {
  id: 'rule-1',
  kind: 'fixed-rule',
  domain: 'docs.example.test',
  action: 'prefer-folder',
  destinationFolderId: 'agent',
  destinationPath: ['开发', 'Agent'],
  source: 'explicit-rule',
  sourceSessionId: 'session-1',
  createdAt: 1,
  updatedAt: 1
};

describe('CapturePreferencesSection', () => {
  it('shows and removes user-authored fixed rules', async () => {
    const user = userEvent.setup();
    const repository = {
      list: vi.fn().mockResolvedValue([rule]),
      remove: vi.fn().mockResolvedValue(undefined)
    };

    render(<CapturePreferencesSection repository={repository as never} />);

    expect(await screen.findByText('docs.example.test')).toBeInTheDocument();
    expect(screen.getByText('归类到 开发 / Agent')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: '删除 docs.example.test 的固定规则'
      })
    );

    await waitFor(() => expect(repository.remove).toHaveBeenCalledWith('rule-1'));
    expect(screen.getByText('还没有固定规则')).toBeInTheDocument();
  });
});
