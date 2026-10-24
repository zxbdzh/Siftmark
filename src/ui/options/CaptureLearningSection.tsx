import { BrainCircuit, FolderInput, Play, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { AgentExperienceService } from '../../capture-agent/experience-service';
import type { CaptureLearningMemory, CapturePreference, CaptureSession } from '../../capture-agent';
import { defaultSleepReviewSettings, type ChromeSettingsRepository, type SleepReviewSettings } from '../../settings/settings-repository';

type LearningSnapshot = Awaited<ReturnType<AgentExperienceService['inspect']>>;

export function CaptureLearningSection({ settingsRepository, experiences }: {
  settingsRepository: ChromeSettingsRepository;
  experiences: AgentExperienceService;
}) {
  const [snapshot, setSnapshot] = useState<LearningSnapshot>();
  const [reviewSettings, setReviewSettings] = useState<SleepReviewSettings>(defaultSleepReviewSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const [next, review] = await Promise.all([experiences.inspect(), settingsRepository.getSleepReviewSettings()]);
    setSnapshot(next); setReviewSettings(review);
  }, [experiences, settingsRepository]);
  useEffect(() => {
    const refresh = () => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '学习数据读取失败')); };
    refresh(); window.addEventListener('focus', refresh);
    const onMessage = (event: unknown) => {
      if (['capture-learning-changed', 'capture-agent-sessions-changed'].includes((event as { type?: string }).type ?? '')) refresh();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => { window.removeEventListener('focus', refresh); browser.runtime.onMessage.removeListener(onMessage); };
  }, [load]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try { setMessage(await action()); await load(); }
    catch (error) { setMessage(`操作未完成：${error instanceof Error ? error.message : '请重试'}`); }
    finally { setBusy(false); }
  };
  const enabled = snapshot?.configuration.enabled ?? false;
  const changeConsent = (nextEnabled: boolean, proactive: boolean) => run(async () => {
    await experiences.configure(nextEnabled, proactive);
    return nextEnabled ? '本地学习已启用；只记录此后在 Siftmark 中的明确操作' : '本地学习已暂停：不再积累证据，也不应用学习经验';
  });
  const respond = (session: CaptureSession, action: 'allow' | 'reject' | 'undo' | 'end') => run(async () => {
    const response = await browser.runtime.sendMessage({ type: 'capture-agent-action', input: { sessionId: session.id, action } }) as { success?: boolean; error?: string };
    if (!response?.success) throw new Error(response?.error ?? '后台 Agent 暂时不可用，请重试');
    return action === 'end' ? '已结束中断的方案；原生书签保持当前状态' : action === 'undo' ? '已撤销方案，并修正相关学习证据' : action === 'reject' ? '已拒绝方案，本次反馈用于修正后续建议' : '已按确认方案执行；可撤销';
  });

  return <section className="capture-learning-section" aria-labelledby="capture-learning-title">
    <div className="section-title-row"><BrainCircuit aria-hidden="true" /><div>
      <h2 id="capture-learning-title">Agent 本地学习与复盘</h2>
      <p>观察明确反馈 → 归纳经验 → 改进建议 → 根据结果修正。</p>
    </div></div>
    <div className="learning-status" data-state={enabled ? 'learned' : 'idle'}>
      <span className="learning-status-mark" aria-hidden="true"><BrainCircuit /></span>
      <div><strong>{enabled ? '本地学习运行中' : '本地学习已暂停'}</strong><p>
        {snapshot?.evidenceCount ?? 0} 条短期证据 · {snapshot?.memories.length ?? 0} 条长期经验 · 学习记录不发送给模型
      </p></div>
      <span className="learning-memory-count">{snapshot?.memories.length ?? 0} 条经验</span>
    </div>
    <div className="preference-list">
      <label className="preference-row"><span><strong>本地学习</strong><small>
        授权记录 Siftmark 内的收藏确认、建议拒绝、分类调整和检索后选择；不观察其他浏览行为，不采集网页正文。
      </small></span><span className="learning-toggle"><input type="checkbox" checked={enabled} disabled={busy || !snapshot}
        onChange={(event) => void changeConsent(event.target.checked, snapshot?.configuration.proactive ?? false)} />
        <span className="learning-toggle-track" aria-hidden="true" /></span></label>
      <label className="preference-row"><span><strong>空闲时主动检查</strong><small>
        每 12 小时最多一轮，扫描最多 200 个书签，最多保留 3 个待确认方案；仅本地运行，不调用模型。
      </small></span><span className="learning-toggle"><input type="checkbox" checked={snapshot?.configuration.proactive ?? false}
        disabled={!enabled || busy} onChange={(event) => void changeConsent(enabled, event.target.checked)} />
        <span className="learning-toggle-track" aria-hidden="true" /></span></label>
      <label className="preference-row"><span><strong>空闲判定</strong><small>扩展后台恢复后仍受同一冷却和方案上限约束。</small></span>
        <span className="range-control"><input type="range" min="5" max="60" step="5" aria-label="睡眠回顾空闲判定" value={reviewSettings.idleMinutes} style={{ '--range-progress': `${((reviewSettings.idleMinutes - 5) / 55) * 100}%` } as CSSProperties}
          onChange={(event) => setReviewSettings({ ...reviewSettings, idleMinutes: Number(event.target.value) })} /><output>{reviewSettings.idleMinutes} 分</output></span>
      </label>
    </div>
    <div className="section-actions learning-actions">
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        await settingsRepository.setSleepReviewSettings({ ...reviewSettings, enabled: enabled && (snapshot?.configuration.proactive ?? false) });
        return '空闲判定已保存';
      })}><Save aria-hidden="true" />保存设置</button>
      <button type="button" disabled={!enabled || busy} onClick={() => void run(async () => {
        const result = await browser.runtime.sendMessage({ type: 'capture-learning-review-now' }) as { summary?: string };
        if (!result?.summary) throw new Error('后台 Agent 未返回结果，请重试');
        return result.summary;
      })}>
        <Play aria-hidden="true" />现在回顾</button>
      <button type="button" disabled={busy || !snapshot} onClick={() => {
        if (window.confirm('清空短期证据、长期经验和未执行的主动方案？原生书签、固定规则和撤销记录保留。'))
          void run(async () => { await experiences.clear(); return '学习数据已清空；旧任务不会重新生成这些记忆'; });
      }}><Trash2 aria-hidden="true" />清空学习数据</button>
    </div>
    <output aria-live="polite">{message}</output>
    <div className="learning-memory-heading"><h3>学到的偏好与可复用策略</h3><a href="#agent" className="learning-history-link">查看采用记录</a></div>
    <p>任务上下文保留在 Agent 记录。短期证据保留 30 天，普通经验至少需要 2 个不同书签的一致反馈，90 天未更新则停止采用。用户纠正优先。</p>
    {snapshot?.memories.length ? <ul className="learning-memory-list">{snapshot.memories.map((memory) =>
      <MemoryRow key={memory.id} memory={memory} folders={snapshot.folders} disabled={busy || !enabled}
        onForget={() => void run(async () => { await experiences.forget(memory.id); return `已删除 ${memory.domain} 的学习记忆`; })}
        onCorrect={(folderId, action) => void run(async () => { await experiences.correct(memory.id, folderId, action); return '纠正已保存，后续建议将使用新的偏好'; })} />
    )}</ul> : <p className="agent-rule-empty">暂无长期经验。开启本地学习后，对两个不同书签作出一致选择即可形成经验；单次操作只保留为短期证据。</p>}
    <div className="learning-memory-heading"><h3>主动发现的待确认方案</h3></div>
    {snapshot?.plans.length ? <ul className="learning-memory-list">{snapshot.plans.map((session) => <li key={session.id}>
      <FolderInput aria-hidden="true" /><div className="memory-main"><strong>{session.sourceSnapshot.title}</strong>
        <p>{session.plan?.reason}</p><small>{session.plan?.destination.path.map((folder) => folder.title).join(' / ')} · {session.state === 'applied' ? '已执行，可撤销' : '等待明确确认'}</small>
        <div className="section-actions">{session.state === 'pending' ? <>
          <button type="button" disabled={busy || !enabled} onClick={() => void respond(session, 'allow')}>确认执行</button>
          <button type="button" disabled={busy} onClick={() => void respond(session, 'reject')}>拒绝建议</button>
        </> : session.state === 'applied' ? <button type="button" disabled={busy} onClick={() => void respond(session, 'undo')}>撤销此方案</button> : <>
          <p>{session.failure?.message}</p>
          {session.operationBatchId ? <button type="button" disabled={busy} onClick={() => void respond(session, 'undo')}>撤销已记录操作</button> : null}
          <button type="button" disabled={busy} onClick={() => void respond(session, 'end')}>结束此方案</button>
        </>}</div>
      </div></li>)}</ul> : <p className="agent-rule-empty">暂无待确认方案。已有经验后可点击「现在回顾」检查位置不一致的书签。</p>}
  </section>;
}

function MemoryRow({ memory, folders, disabled, onForget, onCorrect }: {
  memory: CaptureLearningMemory;
  folders: LearningSnapshot['folders'];
  disabled: boolean;
  onForget(): void;
  onCorrect(folderId: string, action: CapturePreference['action']): void;
}) {
  const [folderId, setFolderId] = useState(memory.destinationFolderId ?? '');
  const [action, setAction] = useState(memory.action);
  useEffect(() => { setFolderId(memory.destinationFolderId ?? ''); setAction(memory.action); }, [memory.destinationFolderId, memory.action]);
  const expired = (memory.expiresAt ?? memory.updatedAt + 90 * 86_400_000) <= Date.now();
  const missing = !folders.some((folder) => folder.id === memory.destinationFolderId);
  return <li><FolderInput aria-hidden="true" /><div className="memory-main">
    <strong>{memory.domain}</strong><p>{memory.reviewSummary}</p><small>
      {memory.action === 'prefer-folder' ? '优先' : '避开'}：{memory.destinationPath.join(' / ') || '书签栏'} ·
      {memory.queryTokens?.length ? `检索词：${memory.queryTokens.join(' ')} · ` : ''}
      {memory.evidenceCount} 个来源 · {memory.confidence === 'high' ? '高' : memory.confidence === 'medium' ? '中' : '低'}置信度 ·
      {missing ? '目录已失效' : expired ? '已过期，不再采用' : memory.status === 'conflicted' ? '反馈冲突，暂不采用' : memory.status === 'corrected' ? '用户已纠正' : '可采用'} ·
      更新于 {new Date(memory.updatedAt).toLocaleString('zh-CN')}
    </small>
    <details><summary>查看来源与纠正</summary>
      <p>来源：{memory.source === 'user-correction' ? '用户明确纠正' : memory.source === 'local-feedback' ? '本地操作反馈归纳' : '历史睡眠回顾'}；证据 ID：{memory.sourceEventIds?.join('、') ?? memory.sourceSessionId}</p>
      <div className="section-actions">
        <label>策略<select aria-label={`纠正 ${memory.domain} 的策略`} value={action} disabled={disabled} onChange={(event) => setAction(event.target.value as CapturePreference['action'])}>
          <option value="prefer-folder">优先目录</option><option value="avoid-folder">避开目录</option></select></label>
        <label>目录<select aria-label={`纠正 ${memory.domain} 的目录`} value={folderId} disabled={disabled} onChange={(event) => setFolderId(event.target.value)}>
          <option value="">选择当前有效目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title || '书签'}</option>)}</select></label>
        <button type="button" disabled={disabled || !folderId} onClick={() => onCorrect(folderId, action)}>保存纠正</button>
      </div>
    </details>
  </div><button type="button" className="icon-button" aria-label={`删除 ${memory.domain} 的学习记忆`} onClick={onForget}><Trash2 aria-hidden="true" /></button></li>;
}
