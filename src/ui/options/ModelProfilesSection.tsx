import {
  Bot,
  CheckCircle2,
  PlugZap,
  Plus,
  Save,
  Search,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ModelProfileService,
  ProfileAssignmentKey
} from '../../ai/profiles/profile-service';
import { providerPresets } from '../../ai/profiles/presets';
import type { ProfileRepository } from '../../ai/profiles/profile-repository';
import { modelProfileKey } from '../../ai/profiles/profile-key';
import type {
  AiCapability,
  AiProtocol,
  AiStructuredOutput,
  ModelProfile
} from '../../ai/types';
import type { ProfileAssignments } from '../../settings/settings-repository';
import { parseModelProfile } from '../../ai/profiles/model-profile';

const capabilities: Array<{ id: AiCapability; label: string }> = [
  { id: 'classify', label: '分类' },
  { id: 'rename', label: '重命名' },
  { id: 'summarize', label: '摘要' },
  { id: 'embed', label: '语义检索' }
];

const assignmentTasks: Array<{
  id: ProfileAssignmentKey;
  label: string;
  capability: AiCapability;
}> = [
  { id: 'agent', label: '收藏 Agent', capability: 'classify' },
  ...capabilities.map((capability) => ({
    ...capability,
    capability: capability.id
  }))
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
  structuredOutput: 'json_schema',
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
  const [editorOpen, setEditorOpen] = useState(false);
  const editorRef = useRef<HTMLDialogElement>(null);
  const verification = useRef<AbortController>();
  const closeEditor = () => {
    verification.current?.abort();
    setEditorOpen(false);
  };
  useEffect(() => () => verification.current?.abort(), []);

  useEffect(() => {
    const dialog = editorRef.current;
    if (!dialog) return;
    if (editorOpen && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!editorOpen && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      dialog.removeAttribute('open');
    }
  }, [editorOpen]);

  const openEditor = (profile?: ModelProfile) => {
    verification.current?.abort();
    verification.current = undefined;
    setTesting(false);
    setForm(
      profile
        ? { ...profile, capabilities: [...profile.capabilities] }
        : {
            ...blank,
            id: crypto.randomUUID(),
            capabilities: [...blank.capabilities]
          }
    );
    setStatus('');
    setEditorOpen(true);
  };
  const [profileQuery, setProfileQuery] = useState('');
  const [profileState, setProfileState] = useState<
    'all' | ModelProfile['state']
  >('all');
  const [profileCapability, setProfileCapability] = useState<
    'all' | AiCapability
  >('all');

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
    assignmentTasks.flatMap(({ id }) => {
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
  const filteredProfiles = useMemo(() => {
    const query = profileQuery.trim().toLocaleLowerCase();
    return profiles
      .filter(
        (profile) => profileState === 'all' || profile.state === profileState
      )
      .filter(
        (profile) =>
          profileCapability === 'all' ||
          profile.capabilities.includes(profileCapability)
      )
      .filter((profile) =>
        query
          ? `${profile.name} ${profile.model} ${profile.endpoint} ${profile.protocol}`
              .toLocaleLowerCase()
              .includes(query)
          : true
      )
      .sort(
        (a, b) =>
          Number(b.state === 'verified') - Number(a.state === 'verified') ||
          (b.verifiedAt ?? 0) - (a.verifiedAt ?? 0) ||
          a.name.localeCompare(b.name, 'zh-CN')
      );
  }, [profileCapability, profileQuery, profileState, profiles]);

  const savedProfile = profiles.find(
    (profile) => keyOf(profile) === keyOf(form)
  );
  const connectionUnchanged =
    savedProfile && sameConnection(savedProfile, form);
  const needsVerification =
    savedProfile?.state === 'verified' && !connectionUnchanged;
  const canAssign = savedProfile?.state === 'verified' && connectionUnchanged;

  const saveDraft = async () => {
    if (needsVerification) {
      setStatus('连接配置已修改，请验证并保存；原可用配置保持不变');
      return;
    }
    const saved = await repository.put({
      ...form,
      state: connectionUnchanged ? savedProfile.state : 'draft',
      verifiedAt: connectionUnchanged ? savedProfile.verifiedAt : undefined
    });
    setProfiles((current) => replaceProfile(current, saved));
    setForm(saved);
    setStatus(
      saved.state === 'verified'
        ? '配置已保存，验证状态与任务分配保持不变'
        : '草稿已保存，尚未验证'
    );
  };

  const testConnection = async () => {
    if (!service) return;
    const controller = new AbortController();
    verification.current = controller;
    setTesting(true);
    setStatus('正在验证连接和所选能力');
    try {
      // 验证前不覆盖存储，失败时最后一份可用配置及任务分配保持不变。
      const draft = parseModelProfile({
        ...form,
        state: 'draft',
        verifiedAt: undefined
      });
      const { profile, probe } = await service.verify(draft, controller.signal);
      setProfiles((current) => replaceProfile(current, profile));
      if (verification.current !== controller || controller.signal.aborted)
        return;
      setForm(profile);
      setStatus(
        `验证通过：文本、结构化输出${probe.embedding ? '、Embedding' : ''}`
      );
    } catch (error) {
      if (verification.current !== controller || controller.signal.aborted)
        return;
      setStatus(
        `验证失败：${error instanceof Error ? error.message : '连接测试失败'}；未保存修改`
      );
    } finally {
      if (verification.current === controller) setTesting(false);
    }
  };

  const activate = async () => {
    if (!service) return;
    try {
      if (!canAssign || !savedProfile) return;
      await service.assign(savedProfile, savedProfile.capabilities);
      setAssignments(await service.getAssignments());
      setStatus('已设为所选任务的默认模型');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '启用失败');
    }
  };

  const updateAssignment = async (
    capability: ProfileAssignmentKey,
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
      const label = assignmentTasks.find(
        (item) => item.id === capability
      )?.label;
      setStatus(profileKey ? `${label} 模型已更新` : `${label}已停用`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '任务模型更新失败');
    }
  };

  const choosePreset = (presetId: string) => {
    const preset = providerPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      name: preset.name,
      protocol: preset.protocol,
      endpoint: preset.endpoint,
      model: preset.model,
      structuredOutput: preset.structuredOutput,
      apiKey: '', // 切换服务商时，不能把旧服务的密钥带入新端点。
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
        API Key 默认保存在此浏览器；启用 WebDAV 全量同步后会加密同步。Ollama
        等本地服务可留空。
      </p>

      <dialog
        ref={editorRef}
        className="model-profile-editor"
        aria-labelledby="model-profile-editor-title"
        onCancel={closeEditor}
        onClose={() => {
          // 原生 close 事件可能延迟到重新打开之后，不能关闭当前的新编辑会话。
          if (!editorRef.current?.open) closeEditor();
        }}
      >
        <header className="model-editor-header">
          <div>
            <span className="settings-eyebrow">模型档案</span>
            <h3 id="model-profile-editor-title">
              {profiles.some((profile) => keyOf(profile) === keyOf(form))
                ? '编辑模型'
                : '新建模型'}
            </h3>
            <p>连接配置验证成功后才替换原配置；失败不会影响正在使用的模型。</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭模型编辑"
            onClick={closeEditor}
          >
            <X size={18} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveDraft().catch((error: unknown) =>
              setStatus(error instanceof Error ? error.message : '配置保存失败')
            );
          }}
        >
          <fieldset className="model-editor-fields" disabled={testing}>
            <label>
              服务商预设
              {/* 每次打开编辑会话都重置原生预设选择，避免显示上一份档案的服务商。 */}
              <select
                key={editorOpen ? keyOf(form) : 'closed'}
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
                  setForm({
                    ...form,
                    endpoint: event.target.value,
                    state: 'draft'
                  })
                }
              />
            </label>
            <label>
              模型
              <input
                required
                value={form.model}
                onChange={(event) =>
                  setForm({
                    ...form,
                    model: event.target.value,
                    state: 'draft'
                  })
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
                  setForm({
                    ...form,
                    apiKey: event.target.value,
                    state: 'draft'
                  })
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
            {form.protocol === 'openai-chat' ||
            form.protocol === 'openai-responses' ? (
              <label>
                结构化输出
                <select
                  value={form.structuredOutput}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      structuredOutput: event.target
                        .value as AiStructuredOutput,
                      state: 'draft'
                    })
                  }
                >
                  <option value="json_schema">
                    JSON Schema（最严格，OpenAI）
                  </option>
                  <option value="json_object">
                    JSON 对象（DeepSeek/通义/智谱等）
                  </option>
                  <option value="prompt-only">仅提示词（Ollama 等）</option>
                </select>
              </label>
            ) : null}
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
          </fieldset>
          <div className="form-actions">
            <button type="submit" disabled={testing || needsVerification}>
              <Save size={16} />
              {savedProfile?.state === 'verified' ? '保存配置' : '保存草稿'}
            </button>
            <button
              type="button"
              disabled={!service || testing || !form.model || !form.endpoint}
              onClick={() => void testConnection()}
            >
              <PlugZap size={16} />
              {testing ? '正在验证' : '验证并保存'}
            </button>
            <button
              type="button"
              disabled={
                !service ||
                testing ||
                !canAssign ||
                form.capabilities.length === 0
              }
              onClick={() => void activate()}
            >
              <CheckCircle2 size={16} />
              设为所选任务默认
            </button>
          </div>
          {needsVerification ? <p>修改尚未保存；原模型继续可用。</p> : null}
          <output>{status}</output>
        </form>
      </dialog>

      <div className="profile-list-block">
        <div className="profile-list-heading">
          <div>
            <h3>模型档案</h3>
            <p>已配置模型及其连接状态。</p>
          </div>
          <div className="profile-list-heading-actions">
            <strong>
              {filteredProfiles.length} / {profiles.length}
            </strong>
            <button
              type="button"
              className="model-profile-add"
              onClick={() => openEditor()}
            >
              <Plus size={15} />
              新建
            </button>
          </div>
        </div>
        <div className="model-profile-toolbar">
          <label className="model-profile-search">
            <Search size={15} />
            <input
              type="search"
              aria-label="搜索模型档案"
              value={profileQuery}
              placeholder="搜索名称、模型 ID、Endpoint…"
              onChange={(event) => setProfileQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="按验证状态筛选"
            value={profileState}
            onChange={(event) =>
              setProfileState(
                event.target.value as 'all' | ModelProfile['state']
              )
            }
          >
            <option value="all">全部状态</option>
            <option value="verified">连接已验证</option>
            <option value="draft">草稿</option>
            <option value="disabled">已停用</option>
          </select>
          <select
            aria-label="按模型能力筛选"
            value={profileCapability}
            onChange={(event) =>
              setProfileCapability(event.target.value as 'all' | AiCapability)
            }
          >
            <option value="all">全部能力</option>
            {capabilities.map((capability) => (
              <option key={capability.id} value={capability.id}>
                {capability.label}
              </option>
            ))}
          </select>
        </div>
        <ul className="model-profile-list">
          {filteredProfiles.map((profile) => {
            const profileKey = keyOf(profile);
            const activeTasks = assignmentTasks
              .filter(
                (task) =>
                  validAssignmentValue(task.id, assignments, profiles) ===
                  profileKey
              )
              .map((task) => task.label);
            return (
              <li
                key={profileKey}
                data-active={assignedKeys.has(profileKey)}
                data-selected={keyOf(form) === profileKey}
              >
                <button type="button" onClick={() => openEditor(profile)}>
                  <span className="model-profile-title">
                    <strong>{profile.name}</strong>
                    <code>{profile.model}</code>
                  </span>
                  <small>
                    {profile.protocol} · {displayEndpoint(profile.endpoint)} ·
                    Key {profile.apiKey ? '已配置' : '未设置'}
                  </small>
                  <span className="model-profile-tags">
                    <span data-state={profile.state}>
                      {profile.state === 'verified'
                        ? '连接已验证'
                        : profile.state === 'disabled'
                          ? '已停用'
                          : '草稿'}
                    </span>
                    {profile.capabilities.map((capability) => (
                      <span key={capability}>
                        {capabilities.find((item) => item.id === capability)
                          ?.label ?? capability}
                      </span>
                    ))}
                  </span>
                </button>
                <aside>
                  <strong>
                    {activeTasks.length ? activeTasks.join('、') : '未分配任务'}
                  </strong>
                  <small>
                    {profile.verifiedAt
                      ? `验证于 ${new Date(profile.verifiedAt).toLocaleDateString('zh-CN')}`
                      : '尚未验证'}
                  </small>
                </aside>
              </li>
            );
          })}
          {!filteredProfiles.length ? (
            <li className="model-profile-empty">没有符合筛选条件的模型档案</li>
          ) : null}
        </ul>
      </div>

      <div className="ai-assignment-panel">
        <div>
          <h3>任务模型</h3>
          <p>每项能力可以使用不同的已验证模型，修改后立即生效。</p>
        </div>
        <div className="ai-assignment-grid">
          {assignmentTasks.map((task) => (
            <label key={task.id}>
              <span>{task.label}</span>
              <select
                value={validAssignmentValue(task.id, assignments, profiles)}
                disabled={!service}
                onChange={(event) =>
                  void updateAssignment(task.id, event.target.value)
                }
              >
                <option value="">未启用</option>
                {verifiedProfiles
                  .filter((profile) =>
                    profile.capabilities.includes(task.capability)
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

function displayEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function sameConnection(a: ModelProfile, b: ModelProfile): boolean {
  return (
    a.protocol === b.protocol &&
    a.endpoint === b.endpoint &&
    a.model === b.model &&
    a.apiKey === b.apiKey &&
    a.timeoutMs === b.timeoutMs &&
    a.structuredOutput === b.structuredOutput &&
    a.capabilities.length === b.capabilities.length &&
    a.capabilities.every((capability) => b.capabilities.includes(capability))
  );
}
function keyOf(profile: ModelProfile): string {
  return modelProfileKey(profile);
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
  capability: ProfileAssignmentKey,
  assignments: ProfileAssignments,
  profiles: ModelProfile[]
): string {
  const assigned = assignments[capability];
  if (!assigned) return '';
  const profile = profiles.find((item) => keyOf(item) === assigned);
  const requiredCapability = capability === 'agent' ? 'classify' : capability;
  return profile?.state === 'verified' &&
    profile.capabilities.includes(requiredCapability)
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
