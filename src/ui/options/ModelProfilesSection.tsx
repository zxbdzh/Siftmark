import { Bot, CheckCircle2, PlugZap, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ModelProfileService } from '../../ai/profiles/profile-service';
import { providerPresets } from '../../ai/profiles/presets';
import type { ProfileRepository } from '../../ai/profiles/profile-repository';
import type { AiCapability, AiProtocol, ModelProfile } from '../../ai/types';
import type { ProfileAssignments } from '../../settings/settings-repository';

const capabilities: Array<{ id: AiCapability; label: string }> = [
  { id: 'classify', label: '分类' },
  { id: 'rename', label: '重命名' },
  { id: 'summarize', label: '摘要' },
  { id: 'embed', label: '语义检索' }
];

const blank: ModelProfile = {
  id: 'custom',
  version: 'v1',
  name: '自定义模型',
  protocol: 'openai-chat',
  endpoint: 'https://api.example.com/v1',
  model: '',
  apiKey: '',
  timeoutMs: 30_000,
  capabilities: ['classify', 'rename', 'summarize'],
  state: 'draft'
};

export function ModelProfilesSection({
  repository,
  service
}: {
  repository: ProfileRepository;
  service?: ModelProfileService;
}) {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [assignments, setAssignments] = useState<ProfileAssignments>({});
  const [form, setForm] = useState(blank);
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void Promise.all([
      repository.list(),
      service?.getAssignments() ?? Promise.resolve({})
    ]).then(([storedProfiles, storedAssignments]) => {
      setProfiles(storedProfiles);
      setAssignments(storedAssignments);
    });
  }, [repository, service]);

  const verifiedProfiles = useMemo(
    () => profiles.filter((profile) => profile.state === 'verified'),
    [profiles]
  );
  const assignedKeys = new Set(
    capabilities.flatMap(({ id }) => {
      const value = validAssignmentValue(id, assignments, profiles);
      return value ? [value] : [];
    })
  );
  const configuredCapabilityCount = capabilities.filter(({ id }) =>
    hasValidAssignment(id, assignments, profiles)
  ).length;
  const classificationReady = hasValidAssignment(
    'classify',
    assignments,
    profiles
  );

  const saveDraft = async () => {
    const saved = await repository.put({
      ...form,
      state: 'draft',
      verifiedAt: undefined
    });
    setProfiles((current) => replaceProfile(current, saved));
    setForm(saved);
    setStatus('草稿已保存，测试连接后才能启用');
    return saved;
  };

  const testConnection = async () => {
    if (!service) return;
    setTesting(true);
    setStatus('正在验证连接和所选能力');
    try {
      const draft = await saveDraft();
      const { profile, probe } = await service.verify(draft);
      setProfiles((current) => replaceProfile(current, profile));
      setForm(profile);
      setStatus(
        `验证通过：文本、结构化输出${probe.embedding ? '、Embedding' : ''}`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  const activate = async () => {
    if (!service) return;
    try {
      await service.assign(form, form.capabilities);
      setAssignments(await service.getAssignments());
      setStatus('此档案已用于全部所选能力');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '启用失败');
    }
  };

  const updateAssignment = async (
    capability: AiCapability,
    profileKey: string
  ) => {
    if (!service) return;
    try {
      if (!profileKey) {
        await service.unassign([capability]);
      } else {
        const profile = profiles.find((item) => keyOf(item) === profileKey);
        if (!profile) throw new Error('所选模型档案不存在');
        await service.assign(profile, [capability]);
      }
      const next = await service.getAssignments();
      setAssignments(next);
      const label = capabilities.find((item) => item.id === capability)?.label;
      setStatus(profileKey ? `${label}模型已更新` : `${label}已停用`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '任务模型更新失败');
    }
  };

  const choosePreset = (presetId: string) => {
    const preset = providerPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      id: preset.id,
      name: preset.name,
      protocol: preset.protocol,
      endpoint: preset.endpoint,
      model: preset.model,
      state: 'draft'
    }));
  };

  const toggleCapability = (capability: AiCapability) =>
    setForm((current) => ({
      ...current,
      state: 'draft',
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter((item) => item !== capability)
        : [...current.capabilities, capability]
    }));

  const setupState = classificationReady
    ? `${configuredCapabilityCount} 项能力已启用`
    : verifiedProfiles.length > 0
      ? '模型已验证，请为分类任务选择模型'
      : profiles.length > 0
        ? '已有草稿，尚未验证'
        : '尚未配置模型';

  return (
    <section id="model-profiles" className="model-profiles-section">
      <div className="ai-setup-summary">
        <Bot size={20} />
        <div>
          <h2>AI 模型</h2>
          <p>{setupState}</p>
        </div>
      </div>
      <p>
        API Key 仅保存在此浏览器的扩展本地存储中，不会跨设备同步。Ollama
        等本地服务可留空。
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveDraft().catch((error: unknown) =>
            setStatus(error instanceof Error ? error.message : '草稿保存失败')
          );
        }}
      >
        <label>
          服务商预设
          <select
            defaultValue=""
            onChange={(event) => choosePreset(event.target.value)}
          >
            <option value="">自定义</option>
            {providerPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input
            required
            value={form.name}
            onChange={(event) =>
              setForm({ ...form, name: event.target.value, state: 'draft' })
            }
          />
        </label>
        <label>
          协议
          <select
            value={form.protocol}
            onChange={(event) =>
              setForm({
                ...form,
                protocol: event.target.value as AiProtocol,
                state: 'draft'
              })
            }
          >
            <option value="openai-chat">OpenAI Chat Completions</option>
            <option value="openai-responses">OpenAI Responses</option>
            <option value="anthropic-messages">Anthropic Messages</option>
            <option value="gemini-generate-content">
              Gemini generateContent
            </option>
          </select>
        </label>
        <label>
          Endpoint
          <input
            required
            type="url"
            value={form.endpoint}
            onChange={(event) =>
              setForm({ ...form, endpoint: event.target.value, state: 'draft' })
            }
          />
        </label>
        <label>
          模型
          <input
            required
            value={form.model}
            onChange={(event) =>
              setForm({ ...form, model: event.target.value, state: 'draft' })
            }
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onChange={(event) =>
              setForm({ ...form, apiKey: event.target.value, state: 'draft' })
            }
          />
        </label>
        <label>
          超时（毫秒）
          <input
            type="number"
            min="5000"
            max="120000"
            value={form.timeoutMs}
            onChange={(event) =>
              setForm({
                ...form,
                timeoutMs: Number(event.target.value),
                state: 'draft'
              })
            }
          />
        </label>
        <fieldset className="form-fieldset">
          <legend>能力</legend>
          {capabilities.map((capability) => (
            <label key={capability.id}>
              <input
                type="checkbox"
                checked={form.capabilities.includes(capability.id)}
                onChange={() => toggleCapability(capability.id)}
              />
              {capability.label}
            </label>
          ))}
        </fieldset>
        <div className="form-actions">
          <button type="submit">
            <Save size={16} />
            保存草稿
          </button>
          <button
            type="button"
            disabled={!service || testing || !form.model || !form.endpoint}
            onClick={() => void testConnection()}
          >
            <PlugZap size={16} />
            {testing ? '正在测试' : '测试连接'}
          </button>
          <button
            type="button"
            disabled={
              !service ||
              form.state !== 'verified' ||
              form.capabilities.length === 0
            }
            onClick={() => void activate()}
          >
            <CheckCircle2 size={16} />
            启用所选能力
          </button>
        </div>
        <output>{status}</output>
      </form>

      {profiles.length > 0 ? (
        <div className="profile-list-block">
          <h3>已保存档案</h3>
          <ul className="settings-list model-profile-list">
            {profiles.map((profile) => (
              <li
                key={keyOf(profile)}
                data-active={assignedKeys.has(keyOf(profile))}
              >
                <button type="button" onClick={() => setForm(profile)}>
                  <span>{profile.name}</span>
                  <small>
                    {profile.model} ·{' '}
                    {profile.state === 'verified' ? '已验证' : '草稿'}
                    {' · '}Key {profile.apiKey ? '••••••' : '未设置'}
                  </small>
                </button>
                {assignedKeys.has(keyOf(profile)) ? (
                  <strong>使用中</strong>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ai-assignment-panel">
        <div>
          <h3>任务模型</h3>
          <p>每项能力可以使用不同的已验证模型，修改后立即生效。</p>
        </div>
        <div className="ai-assignment-grid">
          {capabilities.map((capability) => (
            <label key={capability.id}>
              <span>{capability.label}</span>
              <select
                value={validAssignmentValue(
                  capability.id,
                  assignments,
                  profiles
                )}
                disabled={!service}
                onChange={(event) =>
                  void updateAssignment(capability.id, event.target.value)
                }
              >
                <option value="">未启用</option>
                {verifiedProfiles
                  .filter((profile) =>
                    profile.capabilities.includes(capability.id)
                  )
                  .map((profile) => (
                    <option key={keyOf(profile)} value={keyOf(profile)}>
                      {profile.name} · {profile.model}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

function keyOf(profile: ModelProfile): string {
  return `${profile.id}@${profile.version}`;
}

function replaceProfile(
  profiles: ModelProfile[],
  profile: ModelProfile
): ModelProfile[] {
  return [
    ...profiles.filter((item) => keyOf(item) !== keyOf(profile)),
    profile
  ];
}

function validAssignmentValue(
  capability: AiCapability,
  assignments: ProfileAssignments,
  profiles: ModelProfile[]
): string {
  const assigned = assignments[capability];
  if (!assigned) return '';
  const profile = profiles.find((item) => keyOf(item) === assigned);
  return profile?.state === 'verified' &&
    profile.capabilities.includes(capability)
    ? assigned
    : '';
}

function hasValidAssignment(
  capability: AiCapability,
  assignments: ProfileAssignments,
  profiles: ModelProfile[]
): boolean {
  return Boolean(validAssignmentValue(capability, assignments, profiles));
}
