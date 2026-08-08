import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ManagerLayout } from '../../../src/ui/manager/ManagerLayout';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';

describe('ManagerLayout', () => {
  it('exposes the three workspace regions', () => {
    render(<ManagerLayout nodes={[]} loading={false} repository={{} as BookmarkRepository}/>);
    expect(screen.getByLabelText('文件夹')).toBeInTheDocument();
    expect(screen.getByLabelText('书签列表')).toBeInTheDocument();
    expect(screen.getByLabelText('书签详情')).toBeInTheDocument();
  });

  it('creates a native child folder from the folder context menu', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'child', parentId: 'folder', index: 0, title: '新文件夹' });
    vi.stubGlobal('prompt', vi.fn(() => '新文件夹'));
    render(<ManagerLayout nodes={[{ id: 'folder', parentId: '0', index: 0, title: '工作' }]} loading={false} repository={{ create } as unknown as BookmarkRepository}/>);

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: '工作' }), { clientX: 20, clientY: 30 });
    expect(screen.getByRole('button', { name: '健康检查' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '健康检查' })).toHaveAttribute('title', '健康检查服务将在增强功能启用后可用');
    await userEvent.click(screen.getByRole('button', { name: '新建子文件夹' }));

    expect(create).toHaveBeenCalledWith({ parentId: 'folder', index: 0, title: '新文件夹' });
    vi.unstubAllGlobals();
  });
});
