import { Download, Eye, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  RESET_CONFIRMATION_PHRASE,
  type ResetPreview,
  type ResetScope,
  type ResetService
} from '../../settings/reset-service';

const scopeLabels: Record<ResetScope, string> = {
  'cache-thumbnails': '缓存与缩略图',
  'ai-metadata-index': 'AI 元数据与搜索索引',
  'history-tasks': '操作历史与后台任务',
  'model-configuration': '模型配置',
  'all-siftmark-data': '全部 Siftmark 数据'
};

export function ResetSection({
  service,
  onBackup,
  onResetAll
}: {
  service: ResetService;
  onBackup?(): void;
  onResetAll?(): void;
}) {
  const [scope, setScope] = useState<ResetScope>('cache-thumbnails');
  const [preview, setPreview] = useState<ResetPreview>();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const loadPreview = async () => {
    setBusy(true);
    try {
      setPreview(await service.preview(scope));
      setStatus('已生成重置预览');
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    setBusy(true);
    try {
      const result = await service.execute(scope, {
        confirmationPhrase: confirmation
      });
      if (!result.ok) {
        setStatus(`请输入确认短语：${RESET_CONFIRMATION_PHRASE}`);
        return;
      }
      setStatus(
        `已移除 ${result.removedRows} 条本地记录和 ${result.removedKeys} 个设置键`
      );
      setPreview(undefined);
      setConfirmation('');
      if (scope === 'all-siftmark-data') onResetAll?.();
    } finally {
      setBusy(false);
    }
  };
  const allData = scope === 'all-siftmark-data';
  return (
    <section className="reset-section">
      <h2>重置</h2>
      <div className="reset-controls">
        <label>
          重置范围
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as ResetScope);
              setPreview(undefined);
              setConfirmation('');
              setStatus('');
            }}
          >
            {Object.entries(scopeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadPreview()}
        >
          <Eye size={16} />
          预览影响
        </button>
      </div>
      {preview ? (
        <div className="reset-preview">
          <dl>
            {preview.groups.map((group) => (
              <div key={group.id}>
                <dt>{group.label}</dt>
                <dd>
                  {group.rows} 项 · {formatBytes(group.bytes)}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            合计 {preview.rows} 项，{formatBytes(preview.bytes)}
          </p>
          {allData ? (
            <>
              <button type="button" onClick={onBackup}>
                <Download size={16} />
                先导出备份
              </button>
              <label>
                确认短语
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={RESET_CONFIRMATION_PHRASE}
                  autoComplete="off"
                />
              </label>
            </>
          ) : null}
          <button
            type="button"
            disabled={
              busy || (allData && confirmation !== RESET_CONFIRMATION_PHRASE)
            }
            onClick={() => void execute()}
          >
            <RotateCcw size={16} />
            执行重置
          </button>
        </div>
      ) : null}
      <output aria-live="polite">{status}</output>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}
