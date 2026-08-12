import { describe, expect, it, vi } from 'vitest';
import {
  CaptureAgent,
  type CaptureAgentDependencies,
  type CapturePlan,
  type CaptureSession,
  type CaptureSessionRepository
} from '../../../src/capture-agent';

const source = {
  id: 'bookmark',
  parentId: 'source-folder',
  index: 0,
  title: 'React Server Components Guide',
  url: 'https://example.test/react?token=private'
};

describe('CaptureAgent', () => {
  it('auto-applies a safe plan and returns an undoable receipt', async () => {
    const dependencies = createDependencies({ plan: safePlan() });
    const agent = new CaptureAgent(dependencies);

    const result = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { description: 'React documentation', text: 'Server Components' }
    });

    expect(result).toMatchObject({
      state: 'applied',
      resolution: 'auto',
      operationBatchId: 'batch-1'
    });
    expect(dependencies.executor.execute).toHaveBeenCalledOnce();
    expect(dependencies.executor.stageForApproval).not.toHaveBeenCalled();
  });

  it('records and publishes an auditable analysis trace without raw reasoning', async () => {
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' })
    });
    const onSessionChanged = vi.fn();
    dependencies.onSessionChanged = onSessionChanged;
    dependencies.planner.plan.mockImplementationOnce(async (input) => {
      await input.reportActivity?.({
        id: 'folder-candidates',
        kind: 'folders',
        status: 'completed',
        label: '已比较候选目录',
        detail: '找到 8 个相关目录'
      });
      await input.reportActivity?.({
        id: 'model-analysis',
        kind: 'model',
        status: 'running',
        label: 'AI 正在生成归类方案'
      });
      await input.reportActivity?.({
        id: 'model-analysis',
        kind: 'model',
        status: 'completed',
        label: 'AI 已生成归类方案',
        detail: '内容与 React 文档相关'
      });
      return safePlan({ confidence: 'medium' });
    });
    const agent = new CaptureAgent(dependencies);

    const result = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { text: 'Server Components' }
    });

    expect(result.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'capture',
          status: 'completed',
          label: '原生书签已保存'
        }),
        expect.objectContaining({
          id: 'folder-candidates',
          status: 'completed'
        }),
        expect.objectContaining({
          id: 'model-analysis',
          status: 'completed',
          detail: '内容与 React 文档相关'
        }),
        expect.objectContaining({
          kind: 'risk',
          status: 'completed',
          label: '风险检查完成'
        })
      ])
    );
    expect(onSessionChanged).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'analyzing' })
    );
    expect(JSON.stringify(result.activities)).not.toContain('token=private');
    expect(result.activities[0]).toMatchObject({
      facts: expect.arrayContaining([
        { label: '触发入口', value: '浏览器原生收藏' }
      ]),
      durationMs: 0
    });
    expect(
      result.activities.find((activity) => activity.id === 'page-context')
    ).toMatchObject({
      facts: expect.arrayContaining([
        { label: '正文', value: '17 字符' },
        { label: '页面截图', value: '未提供' }
      ])
    });
  });

  it('reopens an auto-applied bookmark from its current location for adjustment', async () => {
    const revisedPlan = safePlan({
      destination: {
        folderId: 'agent-folder',
        path: [
          { id: 'dev-folder', title: '开发' },
          { id: 'agent-folder', title: 'Agent' }
        ],
        newFolders: [],
        creationSource: 'explicit-user'
      },
      reason: '已移动到 Agent 目录'
    });
    const dependencies = createDependencies({
      plan: safePlan(),
      revisedPlan
    });
    const movedSource = {
      ...source,
      parentId: 'react-folder',
      title: 'React 服务端组件'
    };
    let currentSource = source;
    dependencies.bookmarks.get.mockImplementation(async () => currentSource);
    dependencies.executor.execute.mockImplementation(async () => {
      currentSource = movedSource;
      return { batchId: 'batch-1', bookmarkId: source.id };
    });
    const agent = new CaptureAgent(dependencies);
    const applied = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { text: 'Server Components' }
    });

    const adjusted = await agent.respond(applied.id, {
      type: 'message',
      message: '这次改放到 Agent 目录'
    });

    expect(adjusted).toMatchObject({
      state: 'pending',
      sourceSnapshot: movedSource,
      plan: revisedPlan,
      risk: { canExecute: true }
    });
    expect(dependencies.planner.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          parentId: 'react-folder',
          title: 'React 服务端组件'
        })
      })
    );
  });

  it('stages a risky capture in the inbox and waits for a decision', async () => {
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' })
    });
    const agent = new CaptureAgent(dependencies);

    const result = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { description: 'React documentation', text: 'Server Components' }
    });

    expect(result).toMatchObject({
      state: 'pending',
      risk: { decision: 'approval', reasons: ['low-confidence'] },
      stagingBatchId: 'batch-1'
    });
    expect(dependencies.executor.stageForApproval).toHaveBeenCalledOnce();
    expect(dependencies.executor.execute).not.toHaveBeenCalled();
  });

  it('allows the displayed plan after a final local validation', async () => {
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' })
    });
    const agent = new CaptureAgent(dependencies);
    const pending = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { description: 'React documentation', text: 'Server Components' }
    });

    const result = await agent.respond(pending.id, { type: 'allow' });

    expect(result).toMatchObject({ state: 'applied', resolution: 'allowed' });
    expect(dependencies.executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: pending.id, state: 'executing' })
    );
    expect(dependencies.preferences.put).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'soft', source: 'allow' })
    );
  });

  it('rejects without deleting the staged bookmark', async () => {
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'low' })
    });
    const agent = new CaptureAgent(dependencies);
    const pending = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });

    const result = await agent.respond(pending.id, { type: 'reject' });

    expect(result).toMatchObject({ state: 'rejected', resolution: 'rejected' });
    expect(dependencies.executor.execute).not.toHaveBeenCalled();
    expect(dependencies.executor.remove).not.toHaveBeenCalled();
    expect(dependencies.preferences.put).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'avoid-folder', source: 'reject' })
    );
  });

  it('revises only the current proposal and learns an explicit future rule', async () => {
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' }),
      revisedPlan: safePlan({
        destination: {
          folderId: 'agent-folder',
          path: [
            { id: 'dev-folder', title: '开发' },
            { id: 'agent-folder', title: 'Agent' }
          ],
          newFolders: [],
          creationSource: 'explicit-user'
        },
        reason: '已按你的要求调整'
      })
    });
    const agent = new CaptureAgent(dependencies);
    const pending = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { description: 'React documentation', text: 'Server Components' }
    });

    const adjusted = await agent.respond(pending.id, {
      type: 'message',
      message: '以后这类都放到 Agent 目录'
    });
    const result = await agent.respond(adjusted.id, { type: 'allow' });

    expect(adjusted).toMatchObject({
      state: 'pending',
      plan: { reason: '已按你的要求调整' },
      messages: [
        { role: 'user', text: '以后这类都放到 Agent 目录' },
        { role: 'assistant', text: '已按你的要求调整' }
      ]
    });
    expect(dependencies.planner.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: pending.id }),
        message: '以后这类都放到 Agent 目录'
      })
    );
    expect(result).toMatchObject({
      state: 'applied',
      messages: [
        { role: 'user', text: '以后这类都放到 Agent 目录' },
        { role: 'assistant', text: '已按你的要求调整' }
      ]
    });
    expect(dependencies.preferences.put).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'fixed-rule', source: 'explicit-rule' })
    );
  });

  it('persists adjusting before revision and blocks concurrent actions', async () => {
    const revision = deferred<CapturePlan>();
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' })
    });
    dependencies.planner.revise.mockImplementationOnce(() => revision.promise);
    const agent = new CaptureAgent(dependencies);
    const pending = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });

    const response = agent.respond(pending.id, {
      type: 'message',
      message: 'Move this bookmark to the Agent folder'
    });
    const concurrentMessage = agent.respond(pending.id, {
      type: 'message',
      message: 'Use another folder instead'
    });
    const staleApproval = agent.respond(pending.id, { type: 'allow' });

    await expect(concurrentMessage).rejects.toThrow();
    await expect(staleApproval).rejects.toThrow();
    await vi.waitFor(async () => {
      expect((await dependencies.sessions.get(pending.id))?.state).toBe(
        'adjusting'
      );
    });
    await expect(
      agent.respond(pending.id, { type: 'reject' })
    ).rejects.toThrow();
    expect(dependencies.planner.revise).toHaveBeenCalledOnce();
    expect(dependencies.executor.execute).not.toHaveBeenCalled();

    revision.resolve(safePlan({ reason: 'Moved to the requested folder' }));
    await expect(response).resolves.toMatchObject({ state: 'pending' });
  });

  it('rejects messages while a proposal is not conversational', async () => {
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' })
    });
    const agent = new CaptureAgent(dependencies);
    const pending = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });
    await dependencies.sessions.put({ ...pending, state: 'ready' });

    await expect(
      agent.respond(pending.id, {
        type: 'message',
        message: 'Move this bookmark'
      })
    ).rejects.toThrow();
    expect(dependencies.planner.revise).not.toHaveBeenCalled();
  });

  it.each(['allow', 'reject'] as const)(
    'accepts %s only while pending',
    async (type) => {
      const dependencies = createDependencies({
        plan: safePlan({ confidence: 'medium' })
      });
      const agent = new CaptureAgent(dependencies);
      const pending = await agent.begin({
        bookmarkId: source.id,
        trigger: 'native-bookmark'
      });
      await dependencies.sessions.put({ ...pending, state: 'adjusting' });

      await expect(agent.respond(pending.id, { type })).rejects.toThrow();
      expect(dependencies.executor.execute).not.toHaveBeenCalled();
      expect((await dependencies.sessions.get(pending.id))?.state).toBe(
        'adjusting'
      );
    }
  );

  it('keeps the bookmark unchanged when planning fails and allows retry', async () => {
    const dependencies = createDependencies({
      planningError: new TypeError('fetch failed')
    });
    const agent = new CaptureAgent(dependencies);

    const failed = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });

    expect(failed).toMatchObject({
      state: 'failed',
      failure: { kind: 'network', retryable: true, retryCount: 0 }
    });
    expect(dependencies.executor.execute).not.toHaveBeenCalled();
    expect(dependencies.executor.stageForApproval).not.toHaveBeenCalled();
  });

  it('continues a failed conversation with its existing context', async () => {
    const revisedPlan = safePlan({
      confidence: 'medium',
      reason: '已根据补充要求改用现有目录'
    });
    const dependencies = createDependencies({
      planningError: new TypeError('fetch failed'),
      revisedPlan
    });
    const agent = new CaptureAgent(dependencies);
    const failed = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });
    const previousPlan = safePlan({
      confidence: 'low',
      reason: '上一次方案'
    });
    await dependencies.sessions.put({
      ...failed,
      plan: previousPlan,
      messages: [
        {
          id: 'previous-user',
          role: 'user',
          text: '放到开发目录',
          createdAt: 8
        },
        {
          id: 'previous-assistant',
          role: 'assistant',
          text: '我会查找合适的目录',
          createdAt: 9
        }
      ]
    });

    const recovered = await agent.respond(failed.id, {
      type: 'message',
      message: '不要新建目录，继续尝试'
    });

    expect(recovered).toMatchObject({
      state: 'pending',
      plan: revisedPlan,
      failure: undefined,
      messages: [
        { role: 'user', text: '放到开发目录' },
        { role: 'assistant', text: '我会查找合适的目录' },
        { role: 'user', text: '不要新建目录，继续尝试' },
        { role: 'assistant', text: '已根据补充要求改用现有目录' }
      ]
    });
    expect(dependencies.planner.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          plan: previousPlan,
          messages: expect.arrayContaining([
            expect.objectContaining({ text: '放到开发目录' }),
            expect.objectContaining({ text: '不要新建目录，继续尝试' })
          ])
        }),
        message: '不要新建目录，继续尝试'
      })
    );
  });

  it('retries a failed revision without duplicating the user message', async () => {
    const recoveredPlan = safePlan({
      confidence: 'medium',
      reason: '已在原对话中完成重试'
    });
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' }),
      revisedPlan: recoveredPlan
    });
    dependencies.planner.revise
      .mockImplementationOnce(async (input) => {
        await input.reportActivity?.({
          id: 'model-analysis-revision-1',
          kind: 'model',
          status: 'running',
          label: 'AI 正在重新规划方案'
        });
        throw new TypeError('fetch failed');
      })
      .mockImplementationOnce(async (input) => {
        await input.reportActivity?.({
          id: 'model-analysis-revision-1',
          kind: 'model',
          status: 'running',
          label: 'AI 正在重新规划方案'
        });
        await input.reportActivity?.({
          id: 'model-analysis-revision-1',
          kind: 'model',
          status: 'completed',
          label: 'AI 已生成调整方案'
        });
        return recoveredPlan;
      });
    const agent = new CaptureAgent(dependencies);
    const pending = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });
    const failed = await agent.respond(pending.id, {
      type: 'message',
      message: '不要新建目录'
    });

    const recovered = await agent.respond(failed.id, {
      type: 'retry',
      page: { text: 'Fresh page context' }
    });

    expect(recovered).toMatchObject({
      state: 'pending',
      plan: recoveredPlan,
      failure: undefined,
      messages: [
        { role: 'user', text: '不要新建目录' },
        { role: 'assistant', text: '已在原对话中完成重试' }
      ],
      activities: expect.arrayContaining([
        expect.objectContaining({
          id: 'model-analysis-revision-1',
          status: 'failed'
        }),
        expect.objectContaining({
          id: 'model-analysis-revision-1-retry-1',
          status: 'completed'
        })
      ])
    });
    expect(dependencies.planner.plan).toHaveBeenCalledOnce();
    expect(dependencies.planner.revise).toHaveBeenCalledTimes(2);
    expect(dependencies.planner.revise).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: '不要新建目录',
        page: { text: 'Fresh page context' },
        session: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', text: '不要新建目录' })
          ])
        })
      })
    );
  });

  it('blocks concurrent retries for the same failed session', async () => {
    const retryPlan = deferred<CapturePlan>();
    const dependencies = createDependencies({
      planningError: new TypeError('fetch failed')
    });
    const agent = new CaptureAgent(dependencies);
    const failed = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });
    dependencies.planner.plan.mockImplementationOnce(() => retryPlan.promise);

    const retry = agent.respond(failed.id, { type: 'retry' });
    await expect(agent.respond(failed.id, { type: 'retry' })).rejects.toThrow(
      /正在处理/
    );

    retryPlan.resolve(safePlan({ confidence: 'medium' }));
    await expect(retry).resolves.toMatchObject({ state: 'pending' });
  });

  it('undoes the complete local operation batch', async () => {
    const dependencies = createDependencies({ plan: safePlan() });
    const agent = new CaptureAgent(dependencies);
    const applied = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { description: 'React documentation', text: 'Server Components' }
    });

    const result = await agent.respond(applied.id, { type: 'undo' });

    expect(dependencies.executor.undo).toHaveBeenCalledWith('batch-1');
    expect(result).toMatchObject({ state: 'undone', resolution: 'undone' });
  });

  it('redacts and bounds page context before invoking the planner', async () => {
    const dependencies = createDependencies({ plan: safePlan() });
    const agent = new CaptureAgent(dependencies);

    await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { description: 'd'.repeat(600), text: 't'.repeat(7_000) }
    });

    expect(dependencies.planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ url: 'https://example.test/react' }),
        page: { description: 'd'.repeat(500), text: 't'.repeat(6_000) }
      })
    );
  });

  it('does not turn an applied bookmark into a failure when learning fails', async () => {
    const dependencies = createDependencies({
      plan: safePlan({ confidence: 'medium' })
    });
    dependencies.preferences.put.mockRejectedValueOnce(
      new Error('preference storage unavailable')
    );
    const agent = new CaptureAgent(dependencies);
    const pending = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark',
      page: { text: 'Server Components' }
    });

    await expect(
      agent.respond(pending.id, { type: 'allow' })
    ).resolves.toMatchObject({ state: 'applied', resolution: 'allowed' });
  });

  it('allows user-triggered retries after repeated network failures', async () => {
    const dependencies = createDependencies({
      planningError: new TypeError('fetch failed')
    });
    const agent = new CaptureAgent(dependencies);
    const first = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });
    const second = await agent.respond(first.id, { type: 'retry' });
    const third = await agent.respond(second.id, { type: 'retry' });
    const fourth = await agent.respond(third.id, { type: 'retry' });

    expect(second.failure?.retryCount).toBe(1);
    expect(third.failure?.retryCount).toBe(2);
    expect(fourth).toMatchObject({
      state: 'failed',
      failure: { kind: 'network', retryCount: 3 }
    });
  });

  it('ends a failed task without changing its bookmark or erasing its record', async () => {
    const dependencies = createDependencies({
      planningError: new TypeError('fetch failed')
    });
    const agent = new CaptureAgent(dependencies);
    const failed = await agent.begin({
      bookmarkId: source.id,
      trigger: 'native-bookmark'
    });

    const ended = await agent.respond(failed.id, { type: 'end' });

    expect(ended).toMatchObject({
      state: 'ended',
      resolution: 'ended',
      failure: { kind: 'network', message: 'fetch failed' }
    });
    expect(dependencies.executor.execute).not.toHaveBeenCalled();
    expect(dependencies.executor.remove).not.toHaveBeenCalled();
    expect(dependencies.bookmarks.get).toHaveBeenCalledTimes(1);
  });
});

function safePlan(patch: Partial<CapturePlan> = {}): CapturePlan {
  return {
    destination: {
      folderId: 'react-folder',
      path: [{ id: 'react-folder', title: 'React' }],
      newFolders: []
    },
    title: source.title,
    tags: ['React'],
    summary: 'React documentation',
    confidence: 'high',
    reason: 'matches existing folder',
    relatedBookmarks: [],
    generatedAt: 10,
    ...patch
  };
}

function createDependencies(
  options: {
    plan?: CapturePlan;
    revisedPlan?: CapturePlan;
    planningError?: Error;
  } = {}
) {
  const sessions = new MemorySessions();
  const plan = options.planningError
    ? vi.fn().mockRejectedValue(options.planningError)
    : vi.fn().mockResolvedValue(options.plan ?? safePlan());
  return {
    bookmarks: {
      get: vi.fn().mockResolvedValue(source),
      getTree: vi
        .fn()
        .mockResolvedValue([
          { id: 'root', parentId: '0', index: 0, title: '书签栏' },
          { id: 'source-folder', parentId: 'root', index: 0, title: '收件箱' },
          { id: 'react-folder', parentId: 'root', index: 1, title: 'React' },
          {
            id: 'agent-folder',
            parentId: 'dev-folder',
            index: 0,
            title: 'Agent'
          },
          { id: 'dev-folder', parentId: 'root', index: 2, title: '开发' },
          source
        ])
    },
    sessions,
    preferences: {
      listMatching: vi.fn().mockResolvedValue([]),
      put: vi.fn()
    },
    planner: {
      plan,
      revise: vi
        .fn()
        .mockResolvedValue(options.revisedPlan ?? options.plan ?? safePlan())
    },
    executor: {
      stageForApproval: vi.fn().mockResolvedValue({ batchId: 'batch-1' }),
      execute: vi
        .fn()
        .mockResolvedValue({ batchId: 'batch-1', bookmarkId: source.id }),
      undo: vi.fn().mockResolvedValue({ completed: 2, failed: 0 }),
      remove: vi.fn()
    },
    getSpecialFolderIds: vi.fn().mockResolvedValue(['source-folder']),
    onSessionChanged: undefined as CaptureAgentDependencies['onSessionChanged'],
    now: vi.fn().mockReturnValue(10),
    createId: vi
      .fn()
      .mockReturnValueOnce('session-1')
      .mockReturnValueOnce('batch-1')
      .mockReturnValueOnce('preference-1')
      .mockReturnValueOnce('message-1')
      .mockReturnValueOnce('message-2')
      .mockReturnValue('id'),
    ...({} as Pick<CaptureAgentDependencies, never>)
  } satisfies CaptureAgentDependencies & {
    executor: CaptureAgentDependencies['executor'] & {
      remove: ReturnType<typeof vi.fn>;
    };
  };
}

class MemorySessions implements CaptureSessionRepository {
  private readonly values = new Map<string, CaptureSession>();

  async get(id: string) {
    return this.values.get(id) ?? null;
  }

  async list(limit = 100) {
    return [...this.values.values()].slice(0, limit);
  }

  async listPending(limit = 100) {
    return (await this.list(limit)).filter((session) =>
      [
        'analyzing',
        'ready',
        'pending',
        'adjusting',
        'executing',
        'failed'
      ].includes(session.state)
    );
  }

  async put(session: CaptureSession) {
    this.values.set(session.id, structuredClone(session));
  }

  async appendMessage(id: string, message: CaptureSession['messages'][number]) {
    const current = await this.get(id);
    if (!current) throw new Error('not found');
    const next = {
      ...current,
      state: 'adjusting' as const,
      messages: [...current.messages, message],
      updatedAt: message.createdAt
    };
    await this.put(next);
    return next;
  }

  async resolve(
    id: string,
    resolution: NonNullable<CaptureSession['resolution']>,
    resolvedAt: number,
    operationBatchId?: string
  ) {
    const current = await this.get(id);
    if (!current) return null;
    const next: CaptureSession = {
      ...current,
      state:
        resolution === 'rejected'
          ? 'rejected'
          : resolution === 'ended'
            ? 'ended'
          : resolution === 'undone'
            ? 'undone'
            : 'applied',
      resolution,
      resolvedAt,
      updatedAt: resolvedAt,
      ...(operationBatchId ? { operationBatchId } : {})
    };
    await this.put(next);
    return next;
  }

  async expirePending() {
    return 0;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
