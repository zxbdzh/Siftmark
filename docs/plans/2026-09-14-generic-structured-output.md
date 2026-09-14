# 通用结构化输出支持（修复 DeepSeek）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 模型接入"更通用"：把 JSON Schema 约束从 OpenAI 适配器硬编码中抽成可配置、可自动降级的结构化输出策略，从而修复 DeepSeek（及其它只支持 `json_object` 的 OpenAI 兼容网关）当前完全不可用的问题。

**Architecture:** 在 `ModelProfile` 上新增可选字段 `structuredOutput`（`json_schema | json_object | prompt-only`），预置为各服务商配置适配默认值并更新 DeepSeek 默认模型名；OpenAI Chat ／ Responses 两个适配器按策略构造 `response_format`/`text.format`，并在请求被服务商以 400/422 拒绝时沿 `json_schema → json_object → prompt-only` 自动降级重试。字段设为可选、`parseModelProfile` 统一回填默认值，保证旧存档与既有测试零破坏。

**Tech Stack:** TypeScript、Vitest、Zod、WXT Chrome 扩展。

---

## 背景与根因（已确认）

- [src/ai/adapters/openai-chat.ts](src/ai/adapters/openai-chat.ts) 在连接测试、分析、睡眠回顾三处硬编码发送：
  ```json
  response_format: { "type": "json_schema", "json_schema": { "strict": true, "schema": {...} } }
  ```
  [src/ai/adapters/openai-responses.ts](src/ai/adapters/openai-responses.ts) 同样硬编码 `text.format.type = json_schema`。
- DeepSeek 的 OpenAI 兼容接口对 `response_format` **只支持 `json_object`，不支持 `json_schema`**，收到 `json_schema` 返回错误 → 所有分析失败。
- DeepSeek 预置 `model: 'deepseek-chat'` 已被官方废弃，需改为 `deepseek-v4-flash`。
- 分析提示词 [analysis-prompt.ts](src/ai/prompts/analysis-prompt.ts) 已内嵌 `ANALYSIS_OUTPUT_CONTRACT`（含"JSON"字样与六个字段约束），因此 `json_object` 与 `prompt-only` 模式即便没有 Schema 约束也能由本地 Zod 严格校验兜底。

## 文件结构

- `src/ai/types.ts`：新增 `AiStructuredOutput` 类型与 `DEFAULT_STRUCTURED_OUTPUT` 常量；`ModelProfile` 加 `structuredOutput?: AiStructuredOutput`。
- `src/ai/profiles/model-profile.ts`：schema 加可选 `structuredOutput`；`parseModelProfile` 回填默认值。
- `src/ai/adapters/openai-common.ts`：新增策略→请求体构造与降级辅助函数（Chat 与 Responses 两种形状）。
- `src/ai/profiles/presets.ts`：`ProviderPreset` 加 `structuredOutput`；各服务商配置默认值；DeepSeek 模型名更新。
- `src/ai/adapters/openai-chat.ts`：按策略构造 `response_format` + 自动降级。
- `src/ai/adapters/openai-responses.ts`：按策略构造 `text.format` + 自动降级。
- `src/ui/options/ModelProfilesSection.tsx`：新增"结构化输出"下拉（仅 OpenAI 协议显示），`blank`/`choosePreset` 传递该字段。
- `docs/model-protocols.md`：补充字段说明与降级机制。
- 测试：`tests/unit/ai/openai-chat.test.ts`、`tests/unit/ai/openai-responses.test.ts`、`tests/unit/ai/model-profile`（新建或并入 repository 测试）。

---

### Task 1: 定义 `AiStructuredOutput` 类型与默认值（types.ts）

**Files:**
- Modify: `src/ai/types.ts`

- [ ] **Step 1:** 在 [types.ts](src/ai/types.ts) 顶部新增类型与常量，并在 `ModelProfile` 中加入可选字段。

```typescript
export type AiStructuredOutput = 'json_schema' | 'json_object' | 'prompt-only';
export const DEFAULT_STRUCTURED_OUTPUT: AiStructuredOutput = 'json_schema';
```

在 `ModelProfile` 接口里 `capabilities` 之后新增：

```typescript
  /**
   * OpenAI 兼容协议如何要求结构化 JSON 输出。json_schema 最严格（其余网关可能拒绝）；
   * json_object 要求合法 JSON；prompt-only 仅依赖提示词契约 + 本地 Zod 校验。非 OpenAI 协议忽略。
   */
  structuredOutput?: AiStructuredOutput;
```

- [ ] **Step 2:** 运行类型检查确认无回归。

Run: `pnpm -w exec tsc --noEmit`
Expected: 通过（字段为可选，不影响现有用法）。

- [ ] **Step 3:** Commit（若无 git，则跳过并注明）。

---

### Task 2: model-profile schema 支持新字段并回填默认值

**Files:**
- Modify: `src/ai/profiles/model-profile.ts`

- [ ] **Step 1:** 引入默认值类型，schema 加可选字段，`parseModelProfile` 统一回填默认值。

```typescript
import {
  DEFAULT_STRUCTURED_OUTPUT,
  type AiStructuredOutput,
  type ModelProfile
} from '../types';
```

在 `modelProfileSchema` 中 `capabilities` 之后加入：

```typescript
  structuredOutput: z
    .enum(['json_schema', 'json_object', 'prompt-only'])
    .optional(),
```

将 `parseModelProfile` 改为：

```typescript
export function parseModelProfile(value: unknown): ModelProfile {
  const parsed = modelProfileSchema.parse(value);
  return {
    ...parsed,
    structuredOutput: parsed.structuredOutput ?? DEFAULT_STRUCTURED_OUTPUT
  };
}
```

- [ ] **Step 2:** 运行相关测试确认旧数据（无该字段）与带字段数据都能解析。

Run: `pnpm -w exec vitest run tests/unit/ai/profile-repository.test.ts tests/unit/backup/config-exporter.test.ts`
Expected: 全部通过。

- [ ] **Step 3:** Commit。

---

### Task 3: openai-common 新增策略构造与降级辅助函数

**Files:**
- Modify: `src/ai/adapters/openai-common.ts`

- [ ] **Step 1:** 在 [openai-common.ts](src/ai/adapters/openai-common.ts) 引入类型并新增以下函数（放在 `openAiHeaders` 之后）。

```typescript
import {
  DEFAULT_STRUCTURED_OUTPUT,
  type AiStructuredOutput,
  type ModelProfile
} from '../types';

export const STRUCTURED_OUTPUT_PREFERENCES: AiStructuredOutput[] = [
  'json_schema',
  'json_object',
  'prompt-only'
];

export function structuredOutputFor(
  profile: Pick<ModelProfile, 'protocol' | 'structuredOutput'>
): AiStructuredOutput {
  return profile.structuredOutput ?? DEFAULT_STRUCTURED_OUTPUT;
}

export function isRejectableProviderError(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    error.kind === 'validation' &&
    (error.status === 400 || error.status === 422)
  );
}

interface NamedStructuredSchema {
  name: string;
  schema: unknown;
}

/**
 * OpenAI Chat Completions 的 response_format 值。
 * prompt-only 返回 undefined（不发送该字段，完全靠提示词契约）。
 */
export function chatStructuredOutputFormat(
  kind: AiStructuredOutput,
  named: NamedStructuredSchema
):
  | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: unknown } }
  | { type: 'json_object' }
  | undefined {
  if (kind === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: named.name,
        strict: true,
        schema: named.schema
      }
    };
  }
  if (kind === 'json_object') return { type: 'json_object' };
  return undefined;
}

/** 把 Chat response_format 以可为空的 body 片段返回，便于展开进请求体。 */
export function chatResponseFormatObject(
  kind: AiStructuredOutput,
  named: NamedStructuredSchema
): Record<string, unknown> {
  const format = chatStructuredOutputFormat(kind, named);
  return format ? { response_format: format } : {};
}

/**
 * OpenAI Responses 的 text.format 对象。prompt-only 返回 {}（省略 text 字段）。
 */
export function responsesTextObject(
  kind: AiStructuredOutput,
  named: NamedStructuredSchema
): Record<string, unknown> {
  if (kind === 'json_schema') {
    return {
      text: {
        format: {
          type: 'json_schema',
          name: named.name,
          strict: true,
          schema: named.schema
        }
      }
    };
  }
  if (kind === 'json_object') {
    return { text: { format: { type: 'json_object' } } };
  }
  return {};
}
```

- [ ] **Step 2:** 运行现有适配器相关测试确认无回归。

Run: `pnpm -w exec vitest run tests/unit/ai/openai-chat.test.ts tests/unit/ai/openai-responses.test.ts`
Expected: 全部通过（新增函数未改变默认行为）。

- [ ] **Step 3:** Commit。

---

### Task 4: 更新服务商预置（递归支持 DeepSeek）

**Files:**
- Modify: `src/ai/profiles/presets.ts`

- [ ] **Step 1:** `ProviderPreset` 增加 `structuredOutput`，为各预置配置默认值，并修复 DeepSeek 模型名。

```typescript
import type { AiProtocol, AiStructuredOutput } from '../types';

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  structuredOutput: AiStructuredOutput;
}
```

预置数组改为（仅展示变化的关键行；未列出的字段保持原值）：

```typescript
export const providerPresets: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-responses', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', structuredOutput: 'json_schema' },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic-messages', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', structuredOutput: 'prompt-only' },
  { id: 'gemini', name: 'Gemini', protocol: 'gemini-generate-content', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', structuredOutput: 'json_schema' },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-chat', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', structuredOutput: 'json_object' },
  { id: 'qwen', name: '通义千问', protocol: 'openai-chat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', structuredOutput: 'json_object' },
  { id: 'zhipu', name: '智谱', protocol: 'openai-chat', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', structuredOutput: 'json_object' },
  { id: 'doubao', name: '豆包', protocol: 'openai-chat', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro', structuredOutput: 'json_object' },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-chat', endpoint: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01', structuredOutput: 'json_object' },
  { id: 'ollama', name: 'Ollama', protocol: 'openai-chat', endpoint: 'http://127.0.0.1:11434/v1', model: 'qwen2.5', structuredOutput: 'prompt-only' }
];
```

> 说明：`anthropic`/`gemini` 的 `structuredOutput` 仅作信息记录，其适配器忽略该字段。DeepSeek 改用官方未废弃的 `deepseek-v4-flash` 并默认 `json_object`。

- [ ] **Step 2:** 编译通过。

Run: `pnpm -w exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 3:** Commit。

---

### Task 5: OpenAiChatAdapter 按策略构造并自动降级

**Files:**
- Modify: `src/ai/adapters/openai-chat.ts`
- Test: `tests/unit/ai/openai-chat.test.ts`

- [ ] **Step 1:** 从 [openai-common.ts](src/ai/adapters/openai-common.ts) 导入新辅助函数，删除本地 `isEnhancementCompatibilityError`：

```typescript
import {
  analysisJsonSchema,
  appendEndpointPath,
  chatResponseFormatObject,
  isRejectableProviderError,
  openAiHeaders,
  parseAnalysisText,
  STRUCTURED_OUTPUT_PREFERENCES,
  structuredOutputFor
} from './openai-common';
```

- [ ] **Step 2:** 改写 `testConnection` 的文本探测段（去掉受限于单次的 `try/.../throw`，改为按层级降级重试）：

```typescript
    if (needsText) {
      const prompt = buildAnalysisProbePrompt();
      const startLevel = STRUCTURED_OUTPUT_PREFERENCES.indexOf(
        structuredOutputFor(profile)
      );
      let response: ChatResponse | undefined;
      let lastError: unknown;
      for (let level = startLevel; level < STRUCTURED_OUTPUT_PREFERENCES.length; level += 1) {
        try {
          response = await this.post<ChatResponse>({
            url: appendEndpointPath(profile.endpoint, 'chat/completions'),
            headers: openAiHeaders(profile.apiKey),
            body: {
              model: profile.model,
              messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
              ],
              max_tokens: 256,
              ...chatResponseFormatObject(STRUCTURED_OUTPUT_PREFERENCES[level] as 'json_schema', {
                name: 'siftmark_analysis_probe',
                schema: analysisJsonSchema
              })
            },
            signal,
            timeoutMs: profile.timeoutMs
          });
          if (response.choices?.[0]?.message?.content) break;
        } catch (error) {
          if (!isRejectableProviderError(error)) throw error;
          lastError = error;
        }
      }
      if (!response) throw lastError;
      usageTokens = response.usage?.total_tokens;
      const text = response.choices?.[0]?.message?.content;
      if (!text)
        throw new ProviderError('unknown-result', 'Provider returned no probe result');
      parseAnalysisText(text);
    }
```

> 注：`chatResponseFormatObject` 参数类型为 `AiStructuredOutput`；此处索引结果配合类型断言可简化。这里直接用 `STRUCTURED_OUTPUT_PREFERENCES[level]!`（非空断言）亦可，二选一保持一致。

- [ ] **Step 3:** 改写 `analyze`（按层级降级；增强能力去留遵循原有顺序）：

```typescript
  async analyze(
    profile: ModelProfile,
    context: AiRequestContext,
    signal: AbortSignal
  ): Promise<AiAnalysisResult> {
    const prompt = buildAnalysisPrompt(context);
    const hasEnhancements = Boolean(context.imageDataUrl || context.webSearch);
    const userContent = context.imageDataUrl
      ? [
          { type: 'text', text: prompt.user },
          {
            type: 'image_url',
            image_url: { url: context.imageDataUrl, detail: 'low' }
          }
        ]
      : prompt.user;
    const startLevel = STRUCTURED_OUTPUT_PREFERENCES.indexOf(
      structuredOutputFor(profile)
    );
    const attempt = (level: number, withEnhancements: boolean) =>
      this.post<ChatResponse>({
        url: appendEndpointPath(profile.endpoint, 'chat/completions'),
        headers: openAiHeaders(profile.apiKey),
        signal,
        timeoutMs: profile.timeoutMs,
        body: {
          model: profile.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: withEnhancements ? userContent : prompt.user }
          ],
          ...(withEnhancements && context.webSearch
            ? { web_search_options: { search_context_size: 'low' as const } }
            : {}),
          ...chatResponseFormatObject(STRUCTURED_OUTPUT_PREFERENCES[level]!, {
            name: 'siftmark_analysis',
            schema: analysisJsonSchema
          })
        }
      });

    let response: ChatResponse | undefined;
    let enhancementsAccepted = true;
    let lastError: unknown;
    for (
      let level = startLevel;
      level < STRUCTURED_OUTPUT_PREFERENCES.length;
      level += 1
    ) {
      if (hasEnhancements) {
        try {
          const candidate = await attempt(level, true);
          if (candidate.choices?.[0]?.message?.content) {
            response = candidate;
            break;
          }
        } catch (error) {
          if (!isRejectableProviderError(error)) throw error;
          lastError = error;
        }
      }
      try {
        response = await attempt(level, false);
        enhancementsAccepted = false;
        break;
      } catch (error) {
        if (!isRejectableProviderError(error)) throw error;
        lastError = error;
      }
    }
    if (!response) throw lastError;
    const text = response.choices?.[0]?.message?.content;
    if (!text)
      throw new ProviderError('unknown-result', 'Provider returned no text result');
    return {
      ...parseAnalysisText(text),
      usageTokens: response.usage?.total_tokens,
      ...(context.imageDataUrl || context.webSearch
        ? {
            toolUsage: {
              ...(context.imageDataUrl ? { vision: enhancementsAccepted } : {}),
              ...(context.webSearch
                ? {
                    webSearch: enhancementsAccepted
                      ? ('requested' as const)
                      : ('not-used' as const)
                  }
                : {})
            }
          }
        : {})
    };
  }
```

- [ ] **Step 4:** 同样改写 `reviewCaptureHistory`，按层级降级（无增强，纯循环），关键请求体末尾改用：

```typescript
        max_tokens: 1200,
        ...chatResponseFormatObject(STRUCTURED_OUTPUT_PREFERENCES[level]!, {
          name: 'siftmark_capture_review',
          schema: captureReviewJsonSchema
        })
```

- [ ] **Step 5:** 新增单元测试（追加到 `tests/unit/ai/openai-chat.test.ts`）：

```typescript
  it('uses json_object when the profile prefers it (e.g. DeepSeek)', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    await new OpenAiChatAdapter(post).analyze(
      { ...profile, structuredOutput: 'json_object' },
      { title: 'A', url: 'https://a.test', currentFolderPath: [] },
      new AbortController().signal
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          response_format: { type: 'json_object' }
        })
      })
    );
  });

  it('omits response_format when prompt-only is preferred', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    await new OpenAiChatAdapter(post).analyze(
      { ...profile, structuredOutput: 'prompt-only' },
      { title: 'A', url: 'https://a.test', currentFolderPath: [] },
      new AbortController().signal
    );
    const body = post.mock.calls[0]![0].body as Record<string, unknown>;
    expect(body.response_format).toBeUndefined();
  });

  it('downgrades json_schema to json_object when the provider rejects it', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError('validation', 'invalid format', 400)
      )
      .mockResolvedValueOnce(fixture);
    await expect(
      new OpenAiChatAdapter(post).analyze(
        { ...profile, structuredOutput: 'json_schema' },
        { title: 'A', url: 'https://a.test', currentFolderPath: [] },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ title: '示例' });
    expect(post).toHaveBeenCalledTimes(2);
    const firstBody = post.mock.calls[0]![0].body as {
      response_format: { type: string };
    };
    const secondBody = post.mock.calls[1]![0].body as {
      response_format: { type: string };
    };
    expect(firstBody.response_format.type).toBe('json_schema');
    expect(secondBody.response_format.type).toBe('json_object');
  });
```

- [ ] **Step 6:** 运行该测试文件，确保既有 + 新增用例全部通过。

Run: `pnpm -w exec vitest run tests/unit/ai/openai-chat.test.ts`
Expected: 全部通过。

- [ ] **Step 7:** Commit。

---

### Task 6: OpenAiResponsesAdapter 按策略构造并自动降级

**Files:**
- Modify: `src/ai/adapters/openai-responses.ts`
- Test: `tests/unit/ai/openai-responses.test.ts`

- [ ] **Step 1:** 从 [openai-common.ts](src/ai/adapters/openai-common.ts) 导入，删除本地 `isEnhancementCompatibilityError`：

```typescript
import {
  analysisJsonSchema,
  appendEndpointPath,
  isRejectableProviderError,
  openAiHeaders,
  parseAnalysisText,
  responsesTextObject,
  STRUCTURED_OUTPUT_PREFERENCES,
  structuredOutputFor
} from './openai-common';
```

- [ ] **Step 2:** 改写 `testConnection` 文本探测段，请求体 `text` 改为 `...responsesTextObject(kind, { name: 'siftmark_analysis_probe', schema: analysisJsonSchema })`，并按层级降级循环（结构与 Task 5 的 probe 相同，只是 response 读取用 `readResponseText`）。

- [ ] **Step 3:** 改写 `analyze`：构建 `startLevel` 与 `attempt(level, withEnhancements)`，请求体用 `...responsesTextObject(STRUCTURED_OUTPUT_PREFERENCES[level]!, { name: 'siftmark_analysis', schema: analysisJsonSchema })`，循环逻辑与 Task 5 一致，但文本判断用 `readResponseText(candidate)` 判空。

- [ ] **Step 4:** 改写 `reviewCaptureHistory`：请求体用 `...responsesTextObject(..., { name: 'siftmark_capture_review', schema: captureReviewJsonSchema })`，并按层级降级。

- [ ] **Step 5:** 新增单元测试（参考 Task 5 三个用例，断言 `text.format.type === 'json_object'`、prompt-only 时 `text` 键不存在、以及降级到 `json_object`）。

- [ ] **Step 6:** 运行该测试文件确认全部通过。

Run: `pnpm -w exec vitest run tests/unit/ai/openai-responses.test.ts`
Expected: 全部通过。

- [ ] **Step 7:** Commit。

---

### Task 7: UI 加入结构化输出选择

**Files:**
- Modify: `src/ui/options/ModelProfilesSection.tsx`

- [ ] **Step 1:** `blank` 增加 `structuredOutput: 'json_schema'`；`choosePreset` 增加 `structuredOutput: preset.structuredOutput`。

- [ ] **Step 2:** 在"能力" fieldset 之前插入结构化输出下拉（仅 OpenAI 协议显示）：

```typescript
      {form.protocol === 'openai-chat' || form.protocol === 'openai-responses' ? (
        <label>
          结构化输出
          <select
            value={form.structuredOutput}
            onChange={(event) =>
              setForm({
                ...form,
                structuredOutput: event.target.value as AiStructuredOutput,
                state: 'draft'
              })
            }
          >
            <option value="json_schema">JSON Schema（最严格，OpenAI）</option>
            <option value="json_object">JSON 对象（DeepSeek/通义/智谱等）</option>
            <option value="prompt-only">仅提示词（Ollama 等）</option>
          </select>
        </label>
      ) : null}
```

导入类型：`import type { AiCapability, AiProtocol, AiStructuredOutput, ModelProfile } from '../../ai/types';`

> 选择器改成受限可配置：其余协议（anthropic/gemini）不展示该控件，保持默认即可。

- [ ] **Step 3:** 运行 UI 相关测试。

Run: `pnpm -w exec vitest run tests/unit/ui/model-profiles-section.test.tsx`
Expected: 通过（若该测试断言表单字段快照，按其变化更新）。

- [ ] **Step 4:** Commit。

---

### Task 8: 更新文档

**Files:**
- Modify: `docs/model-protocols.md`

- [ ] **Step 1:** 在"通用约束"后新增一段说明 `structuredOutput` 字段及降级机制；在 OpenAI Chat / Responses 两节注明 `json_object`/`prompt-only` 三种模式；更新"添加服务商预置"示例加入 `structuredOutput`；更新 DeepSeek 默认模型说明。

- [ ] **Step 2:** Commit。

---

### Task 9: 全量回归

- [ ] **Step 1:** 运行完整单测。

Run: `pnpm -w exec vitest run`
Expected: 全部通过。

- [ ] **Step 2:** 运行 e2e 模型档案冒烟（按仓库脚本/配置，可能需启动 dev server；如无法在沙箱运行则说明）。

Run: `pnpm -w exec playwright test tests/e2e/model-profile.spec.ts`
Expected: 通过。

- [ ] **Step 3:** 最终 Commit + 说明改动清单。

---

## 自检

- **Spec 覆盖：** 每个需求点（可配置、自动降级、DeepSeek 修复、主流模型默认适配、文档）均有对应 Task。
- **占位符扫描：** 无 TBD/TODO；关键方法体与测试代码已给全。
- **类型一致性：** `AiStructuredOutput`、`chatResponseFormatObject`、`responsesTextObject`、`structuredOutputFor`、`STRUCTURED_OUTPUT_PREFERENCES` 在全部 Task 中使用一致的命名与签名；`deepseek` 模型名统一 `deepseek-v4-flash`。