import { describe, expect, it, vi } from 'vitest';
import type { ModelProfile } from '../../../src/ai/types';
import type { OrganizationPlan } from '../../../src/bookmarks/organization-planner';
import { organizeBookmarks } from '../../../src/bookmarks/organize-bookmarks';
import type { BookmarkNode } from '../../../src/bookmarks/types';

const profile: ModelProfile = {
  id: 'profile',
  version: '1',
  name: 'Locked model',
  protocol: 'openai-chat',
  endpoint: 'https://model.test',
  model: 'locked-model',
  apiKey: 'secret',
  timeoutMs: 10_000,
  capabilities: ['classify'],
  state: 'verified'
};
const snapshot: BookmarkNode[] = [
  { id: '0', parentId: '', title: '', index: 0 },
  { id: 'bar', parentId: '0', title: '书签栏', index: 0 },
  { id: 'other', parentId: '0', title: '其他书签', index: 1 },
  { id: 'old', parentId: 'bar', title: '混乱旧分类', index: 0 },
  { id: 'bin', parentId: 'bar', title: '回收站', index: 1 },
  { id: 'archive', parentId: 'bar', title: '归档', index: 2 },
  { id: 'a', parentId: 'old', title: 'Alpha', url: 'https://a.test', index: 0 },
  {
    id: 'b',
    parentId: 'other',
    title: 'Beta',
    url: 'https://b.test',
    index: 0
  },
  {
    id: 'c',
    parentId: 'other',
    title: 'Gamma',
    url: 'https://c.test',
    index: 1
  },
  {
    id: 'deleted',
    parentId: 'bin',
    title: 'Deleted',
    url: 'https://deleted.test',
    index: 0
  },
  {
    id: 'archived',
    parentId: 'archive',
    title: 'Archived',
    url: 'https://archive.test',
    index: 0
  },
  {
    id: 'internal',
    parentId: 'bar',
    title: 'Settings',
    url: 'chrome://settings',
    index: 3
  }
];
const folderPath = ['开发', '前端', '参考文档'];
const plan: OrganizationPlan = {
  folders: [{ path: folderPath, purpose: '开发参考' }],
  assignments: ['a', 'b', 'c'].map((bookmarkId) => ({
    bookmarkId,
    folderPath,
    confidence: 'high',
    summary: '参考资料',
    reason: '用途相同'
  }))
};
function fixture(result: OrganizationPlan = plan) {
  const nodes = snapshot.map((node) => ({ ...node }));
  const bookmarks = {
    getTree: vi.fn(async () => nodes.map((node) => ({ ...node }))),
    get: vi.fn(async (id: string) => {
      const node = nodes.find((entry) => entry.id === id);
      return node ? { ...node } : null;
    }),
    create: vi.fn(async (input: Omit<BookmarkNode, 'id'>) => {
      const node = { ...input, id: `created-${nodes.length}` };
      nodes.push(node);
      return { ...node };
    }),
    move: vi.fn(async (id: string, parentId: string) => {
      const node = nodes.find((entry) => entry.id === id)!;
      node.parentId = parentId;
      return { ...node };
    })
  };
  const options = {
    bookmarks,
    planner: { plan: vi.fn().mockResolvedValue(result) },
    backup: vi.fn().mockResolvedValue('backup.html'),
    confirm: vi.fn(async () => true),
    excludedFolderIds: ['bin', 'archive'],
    report: vi.fn(),
    classifyProfile: profile
  };
  return { nodes, bookmarks, options };
}

describe('organizeBookmarks global pipeline', () => {
  it('waits for backup and the entire plan before creating folders or moving bookmarks', async () => {
    const { bookmarks, options } = fixture();
    let finishBackup!: (filename: string) => void;
    let finishPlan!: (value: OrganizationPlan) => void;
    options.backup.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishBackup = resolve;
        })
    );
    options.planner.plan.mockImplementation(
      () =>
        new Promise<OrganizationPlan>((resolve) => {
          finishPlan = resolve;
        })
    );
    const pending = organizeBookmarks(options);
    await vi.waitFor(() => expect(options.backup).toHaveBeenCalled());
    expect(options.backup.mock.calls[0]![0]).toEqual(snapshot);
    expect(options.planner.plan).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
    finishBackup('backup.html');
    await vi.waitFor(() => expect(options.planner.plan).toHaveBeenCalled());
    const [flat, lockedProfile] = options.planner.plan.mock.calls[0]!;
    expect(flat.map((entry: { id: string }) => entry.id)).toEqual([
      'a',
      'b',
      'c'
    ]);
    expect(flat[0].currentFolderPath).toEqual(['混乱旧分类']);
    expect(lockedProfile).toBe(profile);
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
    finishPlan(plan);
    const result = await pending;
    expect(bookmarks.create.mock.calls.map(([input]) => input.title)).toEqual(
      folderPath
    );
    expect(bookmarks.create.mock.calls[0]![0].parentId).toBe('bar');
    expect(bookmarks.move).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      stage: 'completed',
      completed: 3,
      failed: 0,
      skipped: 3,
      read: 3,
      assigned: 3,
      createdFolders: 3
    });
    expect(result.items[0]).toMatchObject({
      sourceFolderPath: ['混乱旧分类'],
      selectedFolderPath: folderPath,
      destinationPath: folderPath,
      action: 'moved'
    });
    expect(
      options.report.mock.calls.map(([progress]) => progress.stage)
    ).toEqual(
      expect.arrayContaining([
        'backup',
        'flattening',
        'reading',
        'creating',
        'moving',
        'completed'
      ])
    );
  });

  it('waits for whole-plan approval without creating or moving anything', async () => {
    const { bookmarks, options } = fixture();
    let approve!: (value: boolean) => void;
    options.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        })
    );
    const pending = organizeBookmarks(options);
    await vi.waitFor(() => expect(options.confirm).toHaveBeenCalled());
    expect(options.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'preview',
        moveCount: 3,
        newFolderPaths: [['开发'], ['开发', '前端'], folderPath]
      })
    );
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
    approve(true);
    expect((await pending).completed).toBe(3);
  });

  it('keeps the whole library unchanged when the preview is cancelled', async () => {
    const { bookmarks, options } = fixture();
    options.confirm.mockResolvedValue(false);
    expect(await organizeBookmarks(options)).toMatchObject({
      stage: 'cancelled',
      createdFolders: 0,
      completed: 0,
      backupFilename: 'backup.html'
    });
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('does not create unapproved directories after the tree changes during preview', async () => {
    const { nodes, bookmarks, options } = fixture();
    nodes.push({ id: 'dev', parentId: 'bar', title: '开发', index: 3 });
    options.confirm.mockImplementation(async () => {
      nodes.splice(
        nodes.findIndex((node) => node.id === 'dev'),
        1
      );
      return true;
    });
    await expect(organizeBookmarks(options)).rejects.toThrow(
      '目录结构在确认期间已变更'
    );
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('does not plan or change bookmarks when backup fails', async () => {
    const { bookmarks, options } = fixture();
    options.backup.mockRejectedValue(new Error('下载取消'));
    await expect(organizeBookmarks(options)).rejects.toThrow('下载取消');
    expect(options.planner.plan).not.toHaveBeenCalled();
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
    expect(options.report.mock.calls.at(-1)![0]).toMatchObject({
      stage: 'failed',
      pipelineError: '下载取消'
    });
  });

  it.each([
    ['missing assignment', { ...plan, assignments: plan.assignments.slice(1) }],
    [
      'duplicate ID',
      { ...plan, assignments: [...plan.assignments, plan.assignments[0]!] }
    ],
    [
      'unknown ID',
      {
        ...plan,
        assignments: plan.assignments.map((entry, index) =>
          index ? entry : { ...entry, bookmarkId: 'unknown' }
        )
      }
    ],
    [
      'unplanned path',
      {
        ...plan,
        assignments: plan.assignments.map((entry) => ({
          ...entry,
          folderPath: ['旧分类']
        }))
      }
    ],
    [
      'too deep',
      {
        folders: [{ path: [...folderPath, '四层'], purpose: '' }],
        assignments: plan.assignments
      }
    ],
    [
      'invalid name',
      {
        folders: [{ path: ['开发/前端'], purpose: '' }],
        assignments: plan.assignments
      }
    ]
  ])('keeps the entire library untouched for %s', async (_label, invalid) => {
    const { bookmarks, options } = fixture(invalid);
    await expect(organizeBookmarks(options)).rejects.toThrow();
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('keeps an item in place when its move fails and continues the remaining moves', async () => {
    const { nodes, bookmarks, options } = fixture();
    bookmarks.move.mockRejectedValueOnce(new Error('移动失败'));
    const result = await organizeBookmarks(options);
    expect(result).toMatchObject({ completed: 2, failed: 1 });
    expect(nodes.find((node) => node.id === 'a')!.parentId).toBe('old');
    expect(result.items[0]).toMatchObject({
      status: 'failed',
      error: '移动失败'
    });
    expect(nodes.find((node) => node.id === 'b')!.title).toBe('Beta');
    expect(nodes.find((node) => node.id === 'b')!.url).toBe('https://b.test');
    expect(nodes.find((node) => node.id === 'deleted')!.parentId).toBe('bin');
  });

  it('never recreates a deleted bookmark and preserves concurrent edits', async () => {
    const { nodes, bookmarks, options } = fixture();
    options.planner.plan.mockImplementation(async () => {
      nodes.splice(
        nodes.findIndex((node) => node.id === 'a'),
        1
      );
      nodes.find((node) => node.id === 'b')!.title = '用户修改';
      return plan;
    });
    const result = await organizeBookmarks(options);
    expect(result).toMatchObject({ completed: 1, failed: 2 });
    expect(bookmarks.create.mock.calls.every(([input]) => !input.url)).toBe(
      true
    );
    expect(bookmarks.move.mock.calls.map(([id]) => id)).toEqual(['c']);
    expect(nodes.find((node) => node.id === 'b')!.title).toBe('用户修改');
  });

  it('rejects ambiguous existing destinations before any mutation', async () => {
    const { nodes, bookmarks, options } = fixture();
    nodes.push(
      { id: 'd1', parentId: 'bar', title: '开发', index: 4 },
      { id: 'd2', parentId: 'bar', title: '开发', index: 5 }
    );
    await expect(organizeBookmarks(options)).rejects.toThrow('多个同名目录');
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('does not reuse an excluded folder as a planned destination', async () => {
    const protectedPlan = {
      folders: [{ path: ['回收站'], purpose: '' }],
      assignments: plan.assignments.map((entry) => ({
        ...entry,
        folderPath: ['回收站']
      }))
    };
    const { bookmarks, options } = fixture(protectedPlan);
    await expect(organizeBookmarks(options)).rejects.toThrow('受保护目录');
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('starts no moves when folder creation fails', async () => {
    const { bookmarks, options } = fixture();
    bookmarks.create.mockRejectedValueOnce(new Error('目录创建失败'));
    await expect(organizeBookmarks(options)).rejects.toThrow('目录创建失败');
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('stops moving into a destination whose identity changes during the task', async () => {
    const { nodes, bookmarks, options } = fixture();
    bookmarks.move.mockImplementationOnce(async (id, parentId) => {
      const node = nodes.find((entry) => entry.id === id)!;
      node.parentId = parentId;
      nodes.find((entry) => entry.id === parentId)!.title = '用户改名';
      return node;
    });
    const result = await organizeBookmarks(options);
    expect(result).toMatchObject({ completed: 1, failed: 2 });
    expect(bookmarks.move).toHaveBeenCalledTimes(1);
  });

  it('skips bookmarks when their ancestor is moved into the recycle bin during planning', async () => {
    const { nodes, bookmarks, options } = fixture();
    options.planner.plan.mockImplementation(async () => {
      nodes.find((node) => node.id === 'old')!.parentId = 'bin';
      return plan;
    });
    const result = await organizeBookmarks(options);
    expect(result.items[0]).toMatchObject({
      status: 'failed',
      error: '书签已进入归档区或回收站，保留原位'
    });
    expect(bookmarks.move.mock.calls.map(([id]) => id)).toEqual(['b', 'c']);
  });

  it('checks a duplicate recycle destination after backup but before spending model requests', async () => {
    const { nodes, bookmarks, options } = fixture(structuredClone(plan));
    nodes.push({ ...nodes.find((node) => node.id === 'a')!, id: 'copy' });
    const recycle = vi.fn();
    const checkRecycle = vi.fn(async () => {
      expect(options.backup).toHaveBeenCalledOnce();
      throw new Error('请先在设置绑定有效回收站，尚未执行改动');
    });
    await expect(organizeBookmarks({ ...options, recycle, checkRecycle })).rejects.toThrow('绑定有效回收站');
    expect(checkRecycle).toHaveBeenCalledOnce();
    expect(options.planner.plan).not.toHaveBeenCalled();
    expect(options.confirm).not.toHaveBeenCalled();
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
    expect(recycle).not.toHaveBeenCalled();
    expect(options.report.mock.calls.at(-1)![0]).toMatchObject({ stage: 'failed', backupFilename: 'backup.html' });
  });

  it('checks the recycle destination again after approval if it was unbound during analysis', async () => {
    const { nodes, bookmarks, options } = fixture(structuredClone(plan));
    nodes.push({ ...nodes.find((node) => node.id === 'a')!, id: 'copy' });
    const recycle = vi.fn();
    const checkRecycle = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('回收站已解绑'));
    await expect(organizeBookmarks({ ...options, recycle, checkRecycle })).rejects.toThrow('回收站已解绑');
    expect(checkRecycle).toHaveBeenCalledTimes(2);
    expect(options.planner.plan).toHaveBeenCalledOnce();
    expect(options.confirm).toHaveBeenCalledOnce();
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
    expect(recycle).not.toHaveBeenCalled();
  });

  it('does not require a recycle destination when the library has no URL copies', async () => {
    const { options } = fixture(structuredClone(plan));
    const checkRecycle = vi.fn().mockRejectedValue(new Error('未配置回收站'));
    const result = await organizeBookmarks({ ...options, checkRecycle });
    expect(result).toMatchObject({ stage: 'completed', completed: 3 });
    expect(checkRecycle).not.toHaveBeenCalled();
  });

  it('analyzes one URL copy, allows a different keeper, and recycles only after confirmation and its move', async () => {
    const { nodes, bookmarks, options } = fixture(structuredClone(plan));
    nodes.push({
      ...nodes.find((node) => node.id === 'a')!,
      id: 'copy',
      dateAdded: 2,
      title: 'Copy'
    });
    nodes.find((node) => node.id === 'a')!.dateAdded = 1;
    const recycle = vi.fn(async (node: BookmarkNode) => {
      await bookmarks.move(node.id, 'bin');
    });
    const confirm = vi.fn(async () => {
      expect(bookmarks.move).not.toHaveBeenCalled();
      expect(recycle).not.toHaveBeenCalled();
      return { approved: true, keepBookmarkIds: { a: 'copy' } };
    });
    const result = await organizeBookmarks({
      ...options,
      confirm,
      recycle,
      checkRecycle: async () => {}
    });
    expect(
      options.planner.plan.mock.calls[0]![0].map(
        (node: { id: string }) => node.id
      )
    ).toEqual(['a', 'b', 'c']);
    expect(result).toMatchObject({
      total: 3,
      completed: 3,
      recycled: 1,
      recycleFailed: 0
    });
    expect(bookmarks.move.mock.calls.map(([id]) => id)).toEqual([
      'copy',
      'b',
      'c',
      'a'
    ]);
    expect(nodes.find((node) => node.id === 'a')!.parentId).toBe('bin');
  });

  it('cancelling a duplicate preview does not recycle or move any copy', async () => {
    const { nodes, bookmarks, options } = fixture();
    nodes.push({ ...nodes.find((node) => node.id === 'a')!, id: 'copy' });
    const recycle = vi.fn();
    const result = await organizeBookmarks({
      ...options,
      recycle,
      checkRecycle: async () => {},
      confirm: async () => false
    });
    expect(result.stage).toBe('cancelled');
    expect(recycle).not.toHaveBeenCalled();
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
  });

  it('does not recycle copies if the keeper disappeared or changed', async () => {
    const { nodes, options } = fixture(structuredClone(plan));
    nodes.push({
      ...nodes.find((node) => node.id === 'a')!,
      id: 'copy',
      dateAdded: 2
    });
    nodes.find((node) => node.id === 'a')!.dateAdded = 1;
    const recycle = vi.fn();
    const result = await organizeBookmarks({
      ...options,
      recycle,
      checkRecycle: async () => {},
      confirm: async () => {
        nodes.find((node) => node.id === 'a')!.url = 'https://changed.test';
        return true;
      }
    });
    expect(result).toMatchObject({ failed: 1, recycleFailed: 1, recycled: 0 });
    expect(recycle).not.toHaveBeenCalled();
  });

  it('rejects an unrelated keeper and a missing recycle destination before directory creation', async () => {
    const { nodes, bookmarks, options } = fixture(structuredClone(plan));
    nodes.push({
      ...nodes.find((node) => node.id === 'a')!,
      id: 'copy',
      dateAdded: 2
    });
    nodes.find((node) => node.id === 'a')!.dateAdded = 1;
    await expect(
      organizeBookmarks({
        ...options,
        recycle: vi.fn(),
        checkRecycle: async () => {},
        confirm: async () => ({ approved: true, keepBookmarkIds: { a: 'b' } })
      })
    ).rejects.toThrow('保留项');
    await expect(organizeBookmarks(options)).rejects.toThrow('回收站');
    expect(bookmarks.create).not.toHaveBeenCalled();
    expect(bookmarks.move).not.toHaveBeenCalled();
  });
});
