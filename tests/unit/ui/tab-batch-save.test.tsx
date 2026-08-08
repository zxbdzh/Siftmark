import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TabBatchSave } from '../../../src/ui/popup/TabBatchSave';

describe('TabBatchSave', () => {
  it('deduplicates URLs and requires confirmation above twenty items', async () => {
    const tabs = Array.from({ length: 21 }, (_, index) => ({ id: index + 1, title: `标签 ${index + 1}`, url: `https://example.test/${index}` }));
    tabs.push({ id: 99, title: '重复', url: tabs[0]!.url });
    render(<TabBatchSave service={{} as never} tabs={tabs} folderId="folder"/>);
    await userEvent.click(screen.getByText('批量保存标签页'));
    await userEvent.click(screen.getByRole('button', { name: '全选 21 项' }));
    await userEvent.click(screen.getByRole('button', { name: '保存所选 21 项' }));
    expect(screen.getByRole('alert')).toHaveTextContent('最多 21 个书签');
    expect(screen.getByRole('button', { name: '确认保存 21 项' })).toBeVisible();
  });
});
