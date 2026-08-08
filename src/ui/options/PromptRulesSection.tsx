import { RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChromeSettingsRepository } from '../../settings/settings-repository';

export function PromptRulesSection({ repository }: { repository?: ChromeSettingsRepository }) {
  const [rules, setRules] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => { if (repository) void repository.getPromptRules().then(setRules); }, [repository]);
  const save = async (value = rules) => { await repository?.setPromptRules(value); setStatus('附加规则已保存'); };
  return <section><h2>AI 附加规则</h2><div className="stacked-field"><label htmlFor="prompt-rules">附加规则</label><textarea id="prompt-rules" maxLength={4000} value={rules} onChange={(event) => setRules(event.target.value)} placeholder="例如：技术文档优先归入“开发资料”"/></div><details><summary>预览用户可控部分</summary><pre>{rules || '无'}</pre></details><div className="form-actions"><button type="button" onClick={() => void save()}><Save size={16}/>保存规则</button><button type="button" onClick={() => { setRules(''); void save(''); }}><RotateCcw size={16}/>恢复默认</button></div><output>{status}</output></section>;
}
