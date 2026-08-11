import {
  BrainCircuit,
  FolderInput,
  MoonStar,
  Play,
  Save,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type {
  CaptureLearningMemory,
  CapturePreference,
  CapturePreferenceRepository
} from '../../capture-agent';
import {
  defaultSleepReviewSettings,
  sleepReviewBounds,
  type ChromeSettingsRepository,
  type SleepReviewSettings,
  type SleepReviewStatus
} from '../../settings/settings-repository';

export function CaptureLearningSection({
  repository,
  settingsRepository
}: {
  repository: CapturePreferenceRepository;
  settingsRepository: ChromeSettingsRepository;
}) {
  const [settings, setSettings] = useState<SleepReviewSettings>(
    defaultSleepReviewSettings
  );
  const [reviewStatus, setReviewStatus] = useState<SleepReviewStatus>({
    state: 'idle'
  });
  const [memories, setMemories] = useState<CaptureLearningMemory[]>([]);
  const [busy, setBusy] = useState<'save' | 'review' | 'clear' | ''>('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [storedSettings, storedStatus, storedMemories] = await Promise.all([
      settingsRepository.getSleepReviewSettings(),
      settingsRepository.getSleepReviewStatus(),
      repository.list('learned')
    ]);
    setSettings(storedSettings);
    setReviewStatus(storedStatus);
    setMemories(storedMemories.filter(isLearningMemory));
  }, [repository, settingsRepository]);

  useEffect(() => {
    void load();
    const handleFocus = () => void load();
    const handleMessage = (event: unknown) => {
      if ((event as { type?: string }).type === 'capture-learning-changed')
        void load();
    };
    window.addEventListener('focus', handleFocus);
    browser.runtime.onMessage.addListener(handleMessage);
    return () => {
      window.removeEventListener('focus', handleFocus);
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, [load]);

  const save = async () => {
    setBusy('save');
    try {
      await settingsRepository.setSleepReviewSettings(settings);
      setMessage(
        settings.enabled ? '睡眠回顾已启用，将在你空闲时运行' : '睡眠回顾已关闭'
      );
    } finally {
      setBusy('');
    }
  };

  const reviewNow = async () => {
    setBusy('review');
    setMessage('');
    try {
      await settingsRepository.setSleepReviewSettings(settings);
      const result = (await browser.runtime.sendMessage({
        type: 'capture-learning-review-now'
      })) as { summary?: string } | undefined;
      setMessage(result?.summary ?? '回顾请求已完成');
      await load();
    } catch (error) {
      setMessage(
        `回顾未完成：${
          error instanceof Error ? error.message : '无法连接后台 Agent'
        }`
      );
    } finally {
      setBusy('');
    }
  };

  const remove = async (memory: CaptureLearningMemory) => {
    await repository.remove(memory.id);
    setMemories((current) =>
      current.filter((candidate) => candidate.id !== memory.id)
    );
    setMessage(`已删除 ${memory.domain} 的学习记忆`);
  };

  const clear = async () => {
    setBusy('clear');
    try {
      const count = await repository.clear('learned');
      setMemories([]);
      setMessage(`已清空 ${count} 条学习记忆`);
    } finally {
      setBusy('');
    }
  };

  return (
    <section
      className="capture-learning-section"
      aria-labelledby="capture-learning-title"
    >
      <div className="section-title-row">
        <BrainCircuit aria-hidden="true" />
        <div>
          <h2 id="capture-learning-title">Agent 学习与睡眠回顾</h2>
          <p>从允许、拒绝和最终目录中提炼本地记忆，改进以后的归类。</p>
        </div>
      </div>

      <div className="learning-status" data-state={reviewStatus.state}>
        <span className="learning-status-mark" aria-hidden="true">
          <MoonStar />
        </span>
        <div>
          <strong>{statusTitle(reviewStatus)}</strong>
          <p>{statusDetail(reviewStatus)}</p>
        </div>
        <span className="learning-memory-count">{memories.length} 条记忆</span>
      </div>

      <div className="preference-list">
        <label className="preference-row">
          <span>
            <strong>空闲时自动回顾</strong>
            <small>
              使用你配置的 Agent
              模型和额度；只更新本地记忆，不会移动书签或创建目录。
            </small>
          </span>
          <span className="learning-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) =>
                setSettings({ ...settings, enabled: event.target.checked })
              }
            />
            <span className="learning-toggle-track" aria-hidden="true" />
          </span>
        </label>
        <label className="preference-row range-row">
          <span>
            <strong>空闲判定</strong>
            <small>Chromium 连续无操作多久后可以开始回顾。</small>
          </span>
          <span className="range-control">
            <input
              type="range"
              aria-label="睡眠回顾空闲判定"
              min={sleepReviewBounds.idleMinutes.min}
              max={sleepReviewBounds.idleMinutes.max}
              step="5"
              disabled={!settings.enabled}
              value={settings.idleMinutes}
              style={rangeProgressStyle(
                settings.idleMinutes,
                sleepReviewBounds.idleMinutes
              )}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  idleMinutes: Number(event.target.value)
                })
              }
            />
            <output>{settings.idleMinutes} 分</output>
          </span>
        </label>
        <label className="preference-row range-row">
          <span>
            <strong>单批最多结果</strong>
            <small>
              至少积累 3 个新结果才运行，每 12 小时最多自动回顾一次。
            </small>
          </span>
          <span className="range-control">
            <input
              type="range"
              aria-label="睡眠回顾单批上限"
              min={sleepReviewBounds.batchSize.min}
              max={sleepReviewBounds.batchSize.max}
              step="1"
              disabled={!settings.enabled}
              value={settings.batchSize}
              style={rangeProgressStyle(
                settings.batchSize,
                sleepReviewBounds.batchSize
              )}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  batchSize: Number(event.target.value)
                })
              }
            />
            <output>{settings.batchSize} 条</output>
          </span>
        </label>
      </div>

      <div className="section-actions learning-actions">
        <button
          type="button"
          className="primary-button"
          disabled={Boolean(busy)}
          onClick={() => void save()}
        >
          <Save aria-hidden="true" />
          {busy === 'save' ? '正在保存' : '保存设置'}
        </button>
        <button
          type="button"
          disabled={!settings.enabled || Boolean(busy)}
          onClick={() => void reviewNow()}
        >
          <Play aria-hidden="true" />
          {busy === 'review' ? '正在回顾' : '现在回顾'}
        </button>
        <output aria-live="polite">{message}</output>
      </div>

      <div className="learning-memory-heading">
        <div>
          <ShieldCheck aria-hidden="true" />
          <h3>学到的弱偏好</h3>
        </div>
        {memories.length > 0 ? (
          <button
            type="button"
            className="danger-text-button"
            disabled={Boolean(busy)}
            onClick={() => void clear()}
          >
            <Trash2 aria-hidden="true" />
            {busy === 'clear' ? '正在清空' : '清空记忆'}
          </button>
        ) : null}
      </div>

      {memories.length > 0 ? (
        <ul className="learning-memory-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <span className="memory-icon" aria-hidden="true">
                <FolderInput />
              </span>
              <div className="memory-main">
                <div>
                  <strong>{memory.domain}</strong>
                  <span data-confidence={memory.confidence}>
                    {confidenceLabel(memory.confidence)}置信度
                  </span>
                </div>
                <p>{memory.reviewSummary}</p>
                <small>
                  {memory.action === 'prefer-folder' ? '偏好' : '避开'}：
                  {memory.destinationPath.join(' / ') || '书签栏'} · 来自{' '}
                  {memory.evidenceCount} 个结果 ·{' '}
                  {formatDate(memory.reviewedAt)}
                </small>
              </div>
              <button
                type="button"
                className="icon-button"
                title="删除记忆"
                aria-label={`删除 ${memory.domain} 的学习记忆`}
                onClick={() => void remove(memory)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-rule-empty">
          暂无学习记忆，启用后会在积累 3 个新结果时开始回顾。
        </p>
      )}
    </section>
  );
}

function rangeProgressStyle(
  value: number,
  bounds: { min: number; max: number }
): CSSProperties {
  const progress = ((value - bounds.min) / (bounds.max - bounds.min)) * 100;
  return { '--range-progress': `${progress}%` } as CSSProperties;
}

function isLearningMemory(
  preference: CapturePreference
): preference is CaptureLearningMemory {
  return preference.kind === 'learned' && preference.source === 'sleep-review';
}

function statusTitle(status: SleepReviewStatus): string {
  if (status.state === 'running') return '正在进行睡眠回顾';
  if (status.state === 'learned') return '最近一次回顾学到了新偏好';
  if (status.state === 'reviewed') return '最近一次回顾没有发现稳定规律';
  if (status.state === 'waiting') return '正在积累新的收藏结果';
  if (status.state === 'failed') return '最近一次回顾未完成';
  if (status.state === 'skipped') return '本次回顾已跳过';
  return '睡眠回顾待机中';
}

function statusDetail(status: SleepReviewStatus): string {
  if (status.error) return status.error;
  if (status.summary) return status.summary;
  return '启用后仅在你空闲时整理结构化分析结果。';
}

function confidenceLabel(confidence: CaptureLearningMemory['confidence']) {
  if (confidence === 'high') return '高';
  if (confidence === 'medium') return '中';
  return '低';
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
