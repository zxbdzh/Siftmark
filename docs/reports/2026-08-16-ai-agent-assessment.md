# AI Agent 现状评估与自主立项

日期：2026-08-16

基线：`main@82583cf`（v0.1.3）

## 阶段零：现状评估

### 系统边界与调用链

Siftmark 是 Manifest V3 Chromium 扩展，没有自建后端。书签事实写入
`chrome.bookmarks`，模型档案与设置写入 `chrome.storage.local`，会话、提案、
用量和操作日志写入 IndexedDB。

```text
Ctrl+D / 快捷键 / 右键 / Popup / 批量操作
                    |
           entrypoints/background.ts
                    |
        +-----------+-------------------+
        |                               |
  CaptureAgent 主链                SmartBookmarkService 旧批量链
  begin/respond                     save/rename
        |                               |
  SmartCapturePlanner              AiAdapterRegistry
        |                               |
        +-------- AiAdapterRegistry ----+
                         |
     OpenAI Chat / Responses / Anthropic / Gemini
                         |
        postProviderJson -> 用户配置的 Endpoint
                         |
  结构化六字段结果 / 本地 Zod 校验 / 请求用量记录
                         |
  risk-policy -> LocalCaptureExecutor -> operationLog/undo
                         |
        Overlay / Popup / Side Panel / Agent 记录
```

主 Agent 调用链证据：

- 组装入口：`entrypoints/background.ts:121-240`。
- 会话入口与状态锁：`src/capture-agent/capture-agent.ts:80-215`。
- 规划、模型上下文与适配器调用：`src/capture-agent/smart-planner.ts:80-239`。
- 风险复核与本地执行：`src/capture-agent/capture-agent.ts:240-300,425-536`。
- 运行时消息接口：`entrypoints/background.ts:833-941`。
- Side Panel 持久对话界面：`entrypoints/sidepanel/App.tsx:224-450,561-900`。

### 能力清单

| 维度       | 已有能力                                                                  | 代码证据                                                                                           |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Agent 入口 | 原生收藏、快捷键、右键、Popup、批量操作                                   | `entrypoints/background.ts:469-568,900-941`                                                        |
| 状态机     | analyzing、pending、adjusting、executing、applied、failed、undo 等        | `src/capture-agent/types.ts:9-20`; `capture-agent.ts:102-536`                                      |
| 工具/插件  | 协议适配器注册表；OpenAI 图片输入与 web search；本地执行器拥有写权限      | `src/ai/adapter-registry.ts:4-9`; `openai-*.ts`; `src/capture-agent/local-executor.ts`             |
| 多轮上下文 | 当前会话消息；送模时仅取最近 10 条；普通/固定/学习偏好                    | `smart-planner.ts:586-619`; `src/capture-agent/preference-repository.ts`; `learning-repository.ts` |
| 长期记忆   | 用户空闲时从已解决会话提炼弱偏好，证据不足则拒绝写入                      | `src/capture-agent/sleep-review.ts:61-269`                                                         |
| LLM 协议   | OpenAI Chat、OpenAI Responses、Anthropic Messages、Gemini GenerateContent | `src/ai/create-adapter-registry.ts:11-23`                                                          |
| 结构化输出 | Provider JSON Schema/提示词契约 + 本地严格 Zod 校验                       | `src/ai/schemas/analysis-contract.ts`; `src/ai/adapters/openai-common.ts:18-100`                   |
| 稳定性基础 | 每档案 5-120 秒超时、统一错误类型、Retry-After 解析、用量记录             | `model-profile.ts:4-22`; `http-client.ts:12-49`; `metered-adapter.ts:89-131`                       |
| 安全边界   | HTTPS/环回 Endpoint、正文/截图上限、敏感文本脱敏、模型无浏览器写权限      | `model-profile.ts:4-8`; `capture-agent.ts:740-866`; `redact-sensitive.ts`                          |
| 可观测性   | 安全审计活动、耗时、模型/任务/Token/状态的本地日志                        | `capture-agent.ts:559-590`; `src/ai/network/request-metrics.ts`                                    |
| 外部接口   | `browser.runtime` 消息、书签事件、alarm、idle、sidePanel                  | `entrypoints/background.ts:833-1052`                                                               |

明确的能力边界：当前没有 token 级流式输出；协议接口返回完整结构化结果
`Promise<AiAnalysisResult>`，HTTP 层直接 `response.json()`。本地“工具调用”是固定的
风险策略和执行器，模型不能任意调用扩展工具。这与当前结构化方案/本地执行的安全设计
一致，因此本轮不把流式输出或开放式工具调用硬立为需求。

### 带证据的短板

#### 1. 功能正确性：部分连接探针不能证明真实分析能力

- OpenAI 两个协议使用 `buildAnalysisProbePrompt`、完整六字段 Schema 和
  `parseAnalysisText`：`openai-chat.ts:43-93`、`openai-responses.ts:46-94`。
- Anthropic 只要求 `{"ok":true}` 并给 32 token：
  `anthropic-messages.ts:24-30`。
- Gemini 同样只使用单字段 `probeJsonSchema`：
  `gemini-generate-content.ts:26-40`。
- 设计文档明确要求连接测试使用代表性六字段结果：
  `docs/design/2026-08-11-capture-agent.md:106-119`。

结果是 Anthropic/Gemini 档案可能被标记 `verified`，但第一次真实分析才暴露字段、
长度或严格 JSON 能力不兼容。

#### 2. 健壮性：已实现的限流与自动重试没有装配到生产链路

- `ProfileLimiter` 已实现每档案并发 2、网络/429/5xx 最多重试两次：
  `src/ai/network/profile-limiter.ts:9-50`。
- 全仓生产代码没有 `new ProfileLimiter` 或 `schedule`；只有它自己的单元测试引用。
- 默认注册表仅按需包装 `MeteredAiAdapter`：
  `src/ai/create-adapter-registry.ts:11-23`。
- Planner、睡眠回顾与普通分析都直接调用适配器：
  `smart-planner.ts:235-239`、`model-memory-reviewer.ts:29-37`、
  `analysis-coordinator.ts:91-124`。

因此超时存在，但文档承诺的按档案并发控制、网络/限流/服务端错误有限重试并未在
实际 Agent 请求中生效。

取消语义也有两个可复现边界：`http-client.ts:13-16` 只注册后续 abort 事件，传入
已经取消的 signal 时不会回放事件，仍可能调用 `fetch`；内部 timeout 和调用方主动
取消又都在 `http-client.ts:33-36` 被映射为同一个 `abort`，导致 timeout 无法按临时
网络错误重试。

#### 3. 安全：旧批量链和相关书签 URL 未统一脱敏

- 旧 `SmartBookmarkService` 把原始 `input.url`、`description`、`pageText`
  直接写入 `AiRequestContext`：`src/bookmarks/smart-bookmark-service.ts:38-68,144-176`。
- 该服务仍被批量归类/重命名入口调用：`entrypoints/background.ts:393-419,907-941`。
- 新 Planner 对相关书签调用 `stripPrivateUrlParts`，该函数只清除 query/hash，
  没有清除 URL `username/password`：`smart-planner.ts:103-113,622-630`。
- 正确的凭据清除逻辑已经存在于 `redactUrlForModel`：
  `src/capture-agent/model-context.ts:70-80`，但没有覆盖上述路径。
- 普通后台分析也在 `analysis-coordinator.ts:91-100` 直接把调用方 context 交给
  adapter；Embedding 文本在 `embedding-indexer.ts:51-58` 拼接标题、目录、标签和
  摘要后直接发送，没有统一敏感文本边界。

可观察风险：形如 `https://user:password@example.test/path?token=x#y` 的书签会在
旧链或相关项上下文中把 Basic Auth 凭据发送给模型 Endpoint；旧链的正文也没有复用
6,000 字符与敏感文本脱敏边界。

#### 4. 可维护性：相同契约存在分叉实现和失效辅助代码

- 四个协议的连接验证本应共享六字段契约，但目前分成完整探针与 `ok` 探针两套。
- `parseProbeText`/`probeJsonSchema` 只服务于较弱的两条探针：
  `src/ai/adapters/openai-common.ts:103-121`。
- `buildCaptureModelContext` 正确实现 6,000 字符和 URL 凭据清除，生产 Planner
  却不调用它；它只被测试引用：`src/capture-agent/model-context.ts:38-67`。
- `canRetryCapture` 同样只被测试引用：`session-lifecycle.ts:67-70`。

本轮只消除与已立 P0 直接相关的契约分叉，不为清理死代码做无关重构。

#### 5. 明显缺陷与文档漂移

- `AnalysisCoordinator.analyze()` 在缺少可用分类档案或模型调用异常时，持久化并返回
  `state: 'failed'` 的提案，而不是抛出异常：
  `src/ai/analysis-coordinator.ts:67-76,103-125`。
- 独立任务处理器忽略上述返回状态并固定报告成功：
  `src/tasks/handlers/analyze-bookmark.ts:15-20`；后台注册的同类入口也有相同行为：
  `entrypoints/background.ts:671-683`。
- 对应集成测试把协调器结果模拟为空对象，只断言成功，未覆盖失败提案：
  `tests/integration/ai-task-handler.test.ts:5-12`。

因此模型不可用或分析失败时，提案记录为失败，但任务进度、UI 和后续重试判断会收到
“成功”的相反结论。这是可复现的状态映射缺陷，应在任务边界修复，同时保留协调器现有
“失败也持久化提案”的可观察性。

- 代码与测试明确保留已解决/过期会话的完整 `messages`：
  `session-repository.ts:122-175`、`session-repository.test.ts:32-53,137-163`。
- 设置页也把完整对话作为“Agent 记录”展示并支持删除：
  `src/ui/options/AgentHistorySection.tsx:85-255`。
- 但架构、用户指南、隐私说明和 Agent 设计仍宣称解决后删除完整对话：
  `docs/architecture.md:71`、`docs/user-guide.md:50`、
  `docs/privacy-and-permissions.md:71`、`docs/design/2026-08-11-capture-agent.md:87`。
- 隐私说明还宣称最多发送 12 个候选目录，生产 Planner 上限实际为 24：
  `docs/privacy-and-permissions.md:37`、`smart-planner.ts:24,119-124`。

这是面向用户的数据保留披露错误。最近提交和自动化测试表明“保留本地 Agent 记录”
是当前有意功能，因此保守修复是让文档如实披露，而不是擅自删除现有历史功能。

未发现源码中的 `TODO`/`FIXME`。首次全量 Vitest 基线在同时运行 typecheck/lint 时出现
1 个 Side Panel 焦点用例失败（311/312 通过），该文件单独复跑 17/17 通过；证据不足以
立为稳定产品缺陷，本轮仅记录为测试时序风险。

### 基线验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test -- --reporter=dot`：独立复跑 96 个文件、312/312 个测试通过。
- `pnpm vitest run tests/unit/ui/sidepanel-agent.test.tsx --reporter=dot`：17/17 通过。

## 阶段一：Issue 清单

只立以下五项，均由上面的代码证据直接推出。

| Issue                                             | 优先级 | 问题                                         | 验收标准                                                                                                                                                                                                  | 影响面                                                                 |
| ------------------------------------------------- | ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [#1](https://github.com/zxbdzh/Siftmark/issues/1) | P0     | 生产适配器未接入按档案限流与有限重试         | 所有协议请求均经过共享 limiter；同一 `id@version` 最大 2 并发；network/429/5xx/内部超时最多重试 2 次；认证/校验/主动中止不重试；预取消不发 fetch                                                          | AI 注册层、HTTP 取消语义与网络包装器；不改调用方接口                   |
| [#2](https://github.com/zxbdzh/Siftmark/issues/2) | P0     | Anthropic/Gemini 连接探针弱于真实六字段契约  | 两协议都发送代表性六字段探针；`{"ok":true}` 被拒绝；合法六字段结果才报告 structured output                                                                                                                | 两个协议适配器及其单测                                                 |
| [#3](https://github.com/zxbdzh/Siftmark/issues/3) | P0     | 活跃 AI 请求路径存在 URL 凭据和敏感正文泄漏  | 建立统一 request-context 安全边界；当前/相关 URL 去掉 user/password/query/hash；描述/正文先脱敏且限制 500/6,000 字符；目录/相关项有界；Embedding 文本脱敏；固定测试捕获发给 adapter/embedding port 的内容 | AI 安全 helper、Planner、Coordinator、旧批量服务、Embedding 及对应测试 |
| [#4](https://github.com/zxbdzh/Siftmark/issues/4) | P0     | Agent 对话保留与候选目录数量的隐私披露不真实 | 架构、用户指南、隐私与 Agent 设计统一说明实际本地保留/删除路径；候选目录上限写为生产值 24；不再声称解决后自动清空                                                                                         | 文档，不改变运行时行为                                                 |
| [#5](https://github.com/zxbdzh/Siftmark/issues/5) | P0     | 失败分析提案被两个任务入口误报为成功         | 仅非 `failed` 提案报告任务成功；失败提案使失败计数递增且仍可观察；两个入口行为一致；回归测试同时覆盖成功、失败与正文清理                                                                           | 两个任务入口及对应测试；不改变协调器契约                               |

### 任务拆分

| 任务 | 依赖 | 可并行 | 独占文件/目录                                                                                                                                                               |
| ---- | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | 无   | 是     | `src/ai/create-adapter-registry.ts`、`src/ai/network/http-client.ts`、新增 adapter wrapper、对应 unit/E2E 测试                                                              |
| #2   | 无   | 是     | `src/ai/adapters/anthropic-messages.ts`、`gemini-generate-content.ts`、`openai-common.ts` 及两份现有测试                                                                    |
| #3   | 无   | 是     | `src/ai/security/` 新 helper、`analysis-coordinator.ts`、`src/bookmarks/smart-bookmark-service.ts`、`src/capture-agent/smart-planner.ts`、`src/search/embedding/`、对应测试 |
| #4   | 无   | 是     | `docs/architecture.md`、`docs/user-guide.md`、`docs/privacy-and-permissions.md`、`docs/design/2026-08-11-capture-agent.md`                                                  |
| #5   | 无   | 是     | `src/tasks/handlers/analyze-bookmark.ts`、`entrypoints/background.ts`、任务处理器回归测试                                                                                    |

五项无文件重叠，可以在独立 worktree/分支并行开发。合并顺序为 #1、#2、#3、#4、#5；
它们没有行为依赖，顺序只用于保持 review 与回归结果可定位。受并发槽位限制，#5 在首批任务
完成后复用工作槽位开发。
