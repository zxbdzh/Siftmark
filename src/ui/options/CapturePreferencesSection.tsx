import { Bot, FolderInput, ShieldX, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  CapturePreference,
  CapturePreferenceRepository
} from '../../capture-agent';

export function CapturePreferencesSection({
  repository
}: {
  repository: CapturePreferenceRepository;
}) {
  const [rules, setRules] = useState<CapturePreference[]>([]);
  const [status, setStatus] = useState('');
  const load = useCallback(
    () => repository.list('fixed-rule').then(setRules),
    [repository]
  );

  useEffect(() => {
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const remove = async (rule: CapturePreference) => {
    await repository.remove(rule.id);
    setRules((current) => current.filter((item) => item.id !== rule.id));
    setStatus(`已删除 ${rule.domain} 的固定规则`);
  };

  return (
    <section className="capture-preferences-section" aria-labelledby="capture-rules-title">
      <div className="section-title-row">
        <Bot aria-hidden="true" />
        <div>
          <h2 id="capture-rules-title">Agent 固定规则</h2>
          <p>仅显示你在对话中明确设为长期生效的收藏规则。</p>
        </div>
      </div>

      {rules.length > 0 ? (
        <ul className="agent-rule-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <div className="agent-rule-main">
                <strong>{rule.domain}</strong>
                <span className="agent-rule-action">
                  {rule.action === 'prefer-folder' ? (
                    <FolderInput aria-hidden="true" />
                  ) : (
                    <ShieldX aria-hidden="true" />
                  )}
                  {describeAction(rule)}
                </span>
                <small>{describeScope(rule)}</small>
              </div>
              <button
                type="button"
                className="icon-button"
                title="删除规则"
                aria-label={`删除 ${rule.domain} 的固定规则`}
                onClick={() => void remove(rule)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-rule-empty">还没有固定规则</p>
      )}
      <output aria-live="polite">{status}</output>
    </section>
  );
}

function describeAction(rule: CapturePreference): string {
  const path = rule.destinationPath.filter(Boolean).join(' / ') || '当前目录';
  return rule.action === 'prefer-folder'
    ? `归类到 ${path}`
    : `不归类到 ${path}`;
}

function describeScope(rule: CapturePreference): string {
  if (rule.urlPrefix) return `网址以 ${rule.urlPrefix} 开头`;
  if (rule.titleIncludes) return `标题包含“${rule.titleIncludes}”`;
  return '匹配此网站';
}
