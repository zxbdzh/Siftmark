import { CheckCircle2, PlugZap, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ModelProfileService } from '../../ai/profiles/profile-service';
import { providerPresets } from '../../ai/profiles/presets';
import type { ProfileRepository } from '../../ai/profiles/profile-repository';
import type { AiCapability, AiProtocol, ModelProfile } from '../../ai/types';

const capabilities: Array<{ id: AiCapability; label: string }> = [
  { id: 'classify', label: '分类' },
  { id: 'rename', label: '重命名' },
  { id: 'summarize', label: '摘要' },
  { id: 'embed', label: '语义检索' }
];
const blank: ModelProfile = { id: 'custom', version: 'v1', name: '自定义模型', protocol: 'openai-chat', endpoint: 'https://api.example.com/v1', model: '', apiKey: '', timeoutMs: 30_000, capabilities: ['classify', 'rename', 'summarize'], state: 'draft' };

export function ModelProfilesSection({ repository, service }: { repository: ProfileRepository; service?: ModelProfileService }) {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [form, setForm] = useState(blank);
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState(false);
  useEffect(() => { void repository.list().then(setProfiles); }, [repository]);
  const saveDraft = async () => {
    const saved = await repository.put({ ...form, state: 'draft', verifiedAt: undefined });
    setProfiles((current) => [...current.filter((item) => item.id !== saved.id || item.version !== saved.version), saved]);
    setForm(saved);
    setStatus('草稿已保存');
    return saved;
  };
  const testConnection = async () => {
    if (!service) return;
    setTesting(true);
    setStatus('正在执行最小连接与结构化输出测试');
    try {
      const draft = await saveDraft();
      const { profile, probe } = await service.verify(draft);
      setProfiles((current) => [...current.filter((item) => item.id !== profile.id || item.version !== profile.version), profile]);
      setForm(profile);
      setStatus(`验证通过：文本、结构化输出${probe.embedding ? '、Embedding' : ''}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : '连接测试失败'); }
    finally { setTesting(false); }
  };
  const activate = async () => {
    if (!service) return;
    await service.assign(form, form.capabilities);
    setStatus('已按所选能力启用此档案');
  };
  const choosePreset = (presetId: string) => {
    const preset = providerPresets.find((item) => item.id === presetId);
    if (preset) setForm((current) => ({ ...current, id: preset.id, name: preset.name, protocol: preset.protocol, endpoint: preset.endpoint, model: preset.model, state: 'draft' }));
  };
  const toggleCapability = (capability: AiCapability) => setForm((current) => ({ ...current, state: 'draft', capabilities: current.capabilities.includes(capability) ? current.capabilities.filter((item) => item !== capability) : [...current.capabilities, capability] }));
  return <section><h2>模型档案</h2><p>API Key 以原值保存在此浏览器的扩展本地存储中，不跨设备同步。</p><form onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}><label>服务商预设<select defaultValue="" onChange={(event) => choosePreset(event.target.value)}><option value="">自定义</option>{providerPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label><label>名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value, state: 'draft' })}/></label><label>协议<select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as AiProtocol, state: 'draft' })}><option value="openai-chat">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="gemini-generate-content">Gemini generateContent</option></select></label><label>Endpoint<input required type="url" value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value, state: 'draft' })}/></label><label>模型<input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value, state: 'draft' })}/></label><label>API Key<input type="password" autoComplete="off" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value, state: 'draft' })}/></label><label>超时（毫秒）<input type="number" min="1000" max="300000" value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value), state: 'draft' })}/></label><fieldset className="form-fieldset"><legend>能力</legend>{capabilities.map((capability) => <label key={capability.id}><input type="checkbox" checked={form.capabilities.includes(capability.id)} onChange={() => toggleCapability(capability.id)}/>{capability.label}</label>)}</fieldset><div className="form-actions"><button type="submit"><Save size={16}/>保存草稿</button><button type="button" disabled={!service || testing || !form.model || !form.apiKey} onClick={() => void testConnection()}><PlugZap size={16}/>{testing ? '正在测试' : '测试连接'}</button><button type="button" disabled={!service || form.state !== 'verified'} onClick={() => void activate()}><CheckCircle2 size={16}/>启用已验证档案</button></div><output>{status}</output></form><ul className="settings-list">{profiles.map((profile) => <li key={`${profile.id}-${profile.version}`}><button type="button" onClick={() => setForm(profile)}>{profile.name} · {profile.state === 'verified' ? '已验证' : '未验证'} · Key {profile.apiKey ? '••••••' : '未设置'}</button></li>)}</ul></section>;
}
