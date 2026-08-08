import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagerLayout } from '../../../src/ui/manager/ManagerLayout';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';
import type { ArchiveService } from '../../../src/bookmarks/archive-service';
import type { RecycleService } from '../../../src/bookmarks/recycle-service';
import { useManagerStore } from '../../../src/ui/manager/manager-store';

describe('ManagerLayout', () => {
  beforeEach(() => {
    useManagerStore.setState({
      selectedFolderId: null,
      selectedBookmarkIds: new Set(),
      detailBookmarkId: null,
      focusedBookmarkId: null,
      selectionAnchorId: null
    });
  });

  it('exposes the three workspace regions', () => {
    render(
      <ManagerLayout
        nodes={[]}
        loading={false}
        repository={{} as BookmarkRepository}
      />
    );
    expect(screen.getByLabelText('文件夹')).toBeInTheDocument();
    expect(screen.getByLabelText('书签列表')).toBeInTheDocument();
    expect(screen.getByLabelText('书签详情')).toBeInTheDocument();
  });

  it('creates a native child folder from the folder context menu', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({
        id: 'child',
        parentId: 'folder',
        index: 0,
        title: '新文件夹'
      });
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '新文件夹')
    );
    render(
      <ManagerLayout
        nodes={[{ id: 'folder', parentId: '0', index: 0, title: '工作' }]}
        loading={false}
        repository={{ create } as unknown as BookmarkRepository}
      />
    );

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: '工作' }), {
      clientX: 20,
      clientY: 30
    });
    expect(screen.getByRole('button', { name: '健康检查' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '健康检查' })).toHaveAttribute(
      'title',
      '健康检查服务将在增强功能启用后可用'
    );
    await userEvent.click(screen.getByRole('button', { name: '新建子文件夹' }));

    expect(create).toHaveBeenCalledWith({
      parentId: 'folder',
      index: 0,
      title: '新文件夹'
    });
    vi.unstubAllGlobals();
  });

  it('shows actual special-folder destinations and hides archived items from the regular list', async () => {
    const nodes = [
      { id: 'work', parentId: '0', index: 0, title: '工作' },
      { id: 'archive', parentId: '0', index: 1, title: '季度归档' },
      { id: 'recycle', parentId: '0', index: 2, title: '稍后清理' },
      {
        id: 'normal',
        parentId: 'work',
        index: 0,
        title: '普通书签',
        url: 'https://example.com'
      },
      {
        id: 'archived',
        parentId: 'archive',
        index: 0,
        title: '已归档书签',
        url: 'https://archive.example'
      }
    ];
    render(
      <ManagerLayout
        nodes={nodes}
        loading={false}
        repository={{} as BookmarkRepository}
        archiveService={{} as ArchiveService}
        recycleService={{} as RecycleService}
        archiveDestination={nodes[1]}
        recycleDestination={nodes[2]}
        specialFolderPlacements={
          new Map([
            [
              'archived',
              {
                bookmarkId: 'archived',
                state: 'archived',
                originalParentId: 'work',
                originalIndex: 1,
                destinationFolderId: 'archive',
                movedAt: 1
              }
            ]
          ])
        }
      />
    );

    expect(screen.getByText('普通书签')).toBeInTheDocument();
    expect(screen.queryByText('已归档书签')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('普通书签'));
    const normalMenu = within(screen.getByLabelText('书签操作'));
    expect(
      normalMenu.getByRole('button', { name: '归档到「季度归档」' })
    ).toBeEnabled();
    expect(
      normalMenu.getByRole('button', { name: '移到「稍后清理」' })
    ).toBeEnabled();

    await userEvent.click(screen.getByRole('treeitem', { name: '季度归档' }));
    fireEvent.contextMenu(screen.getByText('已归档书签'));
    const archivedMenu = within(screen.getByLabelText('书签操作'));
    expect(
      archivedMenu.getByRole('button', { name: '恢复到「工作」' })
    ).toBeEnabled();
  });
});
