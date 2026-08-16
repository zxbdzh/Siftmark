# AI Agent 自主调研与交付报告

日期：2026-08-17  
调研固定点：`82583cf`  
开发差异固定点：`51568f6`  
最终功能提交：`f8574ab`

## 结论

本轮完成了“调研 -> 立项 -> 并发开发 -> 合并 -> 独立测试 -> Computer-Use 验收 ->
双轴终审 -> 修正 -> 复验”的完整闭环。基于代码证据创建并完成 5 个 P0 issue，
没有为流式输出、开放式工具调用或新框架制造缺少依据的需求，也没有新增依赖或改变对外接口。

相对 `51568f6` 的最终功能差异为 37 个文件、1,072 行新增、146 行删除。
最终门禁为 100 个 Vitest 文件、333/333 项测试和 25/25 项 Playwright E2E 全部通过。

完整调研证据见
[现状评估与自主立项](./2026-08-16-ai-agent-assessment.md)，逐项测试证据见
[AI Agent 合并后验证证据](../testing/evidence/2026-08-17-ai-agent-validation.md)。

## 现状评估摘要

### 架构与调用链

```text
Ctrl+D / 原生收藏 / Popup / 右键 / 批量任务
                    |
           entrypoints/background.ts
                    |
        +-----------+-------------------+
        |                               |
  CaptureAgent 主链                SmartBookmarkService 旧批量链
  begin/respond                         save/rename
        |                               |
  SmartCapturePlanner              AnalysisCoordinator
        |                               |
        +-------- AiAdapterRegistry ----+
                         |
      ProfileLimitedAiAdapter -> MeteredAiAdapter
                         |
 OpenAI Chat / Responses / Anthropic Messages / Gemini generateContent
                         |
       postProviderJson -> 用户配置的模型 Endpoint
                         |
       六字段结构化结果 + 本地 Zod 严格校验
                         |
 risk-policy -> LocalCaptureExecutor -> operationLog/undo
                         |
 Overlay / Popup / Side Panel / Agent 记录 / 使用统计
```

### 已有能力

| 维度       | 调研结论                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------- |
| Agent 入口 | 原生收藏、快捷键、右键、Popup、批量任务均进入后台编排                                       |
| 工具/插件  | 固定协议 Adapter registry；OpenAI 识图/联网搜索；本地执行器持有书签写权限，模型本身无写权限 |
| 上下文     | 当前会话最近 10 条消息、目录候选、相关书签和用户规则                                        |
| 长期记忆   | IndexedDB 会话、普通偏好、显式固定规则和空闲睡眠回顾记忆                                    |
| LLM 层     | 四种协议、六字段 Schema、本地严格解析、超时、统一错误与本地用量日志                         |
| 配置       | ModelProfile 与任务能力分配保存在 `chrome.storage.local`，API Key 不进入同步存储            |
| 扩展点     | `AiAdapter`、registry、profile preset、domain port/repository、runtime message handler      |
| 外部接口   | `browser.runtime` 消息、书签事件、alarm、idle、sidePanel；没有自建服务端                    |

调研确认当前没有 token 级流式输出，模型也不能任意调用开放工具；但现有产品刻意采用
“完整结构化结果 + 本地受控执行器”的安全边界，因此没有把二者臆造为本轮缺陷。

### 立项依据

| 类型       | 代码证据与结论                                                                                                                                     | 对应 issue |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 功能正确性 | Anthropic/Gemini 仅用 `{ok:true}` 探针，弱于生产六字段契约；证据位于原 `anthropic-messages.ts:24-30`、`gemini-generate-content.ts:26-40`           | #2         |
| 健壮性     | `ProfileLimiter` 已实现却未装配；预取消仍可能 fetch，内部超时与外部取消混同；证据位于原 `create-adapter-registry.ts:11-23`、`http-client.ts:13-36` | #1         |
| 安全       | 旧批量链、相关 URL、Coordinator 与 Embedding 没有统一脱敏边界；证据位于原 `smart-bookmark-service.ts:38-68,144-176` 等                             | #3         |
| 可维护性   | 四协议探针契约分叉，安全限制散落且已有 helper 未被生产路径统一复用                                                                                 | #2、#3     |
| 明显 bug   | `AnalysisCoordinator` 返回失败提案，但两个任务入口仍固定报告成功                                                                                   | #5         |
| 文档/隐私  | 运行时保留完整会话，四份文档却宣称结束后删除；候选目录文档写 12，生产值是 24                                                                       | #4         |

源码中未发现 TODO/FIXME。调研基线独立复跑为 typecheck、lint 通过，96 个 Vitest 文件、
312/312 项通过；一次并行压力下的 Side Panel 焦点失败无法稳定复现，因此只登记为残余时序风险，
没有凭一次偶发结果立项。

## Issue 清单与立项理由

| Issue                                                                              | 优先级 | 立项理由                                                                | 范围与验收                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/zxbdzh/Siftmark/issues/1) 档案并发限制、有限重试与取消语义 | P0     | 已有 limiter 未进入生产调用链，稳定性设计未生效                         | 适配器装配、HTTP 边界与 limiter wrapper；同档案并发 2、临时错误最多重试 2 次、主动取消不重试、预取消不 fetch、每次物理请求独立计量 |
| [#2](https://github.com/zxbdzh/Siftmark/issues/2) Anthropic/Gemini 六字段连接探针  | P0     | verified 状态不能证明真实分析契约可用                                   | 两协议适配器与共享 probe helper；完整六字段才通过，旧 `{ok:true}` 必须失败                                                         |
| [#3](https://github.com/zxbdzh/Siftmark/issues/3) AI 与 Embedding 统一输入安全边界 | P0     | 活跃路径可能向用户 Endpoint 发送 URL 凭据、query、fragment 或未脱敏正文 | 共享 sanitizer、三条分析链和 Embedding；500/6000/24/5 上限与端口捕获测试                                                           |
| [#4](https://github.com/zxbdzh/Siftmark/issues/4) Agent 会话保留隐私披露           | P0     | 面向用户的数据保留说明与真实 IndexedDB 行为相反                         | 仅四份文档；如实说明本地保留、删除路径、24 个候选目录和偏好不随会话删除                                                            |
| [#5](https://github.com/zxbdzh/Siftmark/issues/5) 失败提案任务状态映射             | P0     | 任务进度与已持久化提案状态会互相矛盾                                    | 两个任务入口共享映射；失败提案返回 failed、失败计数递增、成功路径保持不变                                                          |

五项均直接来自阶段零证据。#1 至 #4 首批并行，#5 在槽位释放后开发；文件归属在
现状报告的任务拆分表中锁定。五项没有行为依赖，合并顺序仅用于保持定位和回归清晰。

## 关键改动与设计理由

### #1 请求韧性

- 新增 `ProfileLimitedAiAdapter`，所有默认协议统一经共享 `ProfileLimiter`。
- key 使用 `profile.id@version`，同一档案最多两个物理请求，不同版本互不阻塞。
- 组合顺序为 `ProfileLimited(Metered(raw))`，因此每次重试都形成独立用量记录。
- network、429、5xx 和内部超时最多总计尝试 3 次；认证、授权、校验、未知结果和外部取消不重试。
- HTTP 层在 fetch 前检查预取消，并区分内部 timeout 与调用方 abort。

选择 wrapper 而非修改四个协议，是为了让稳定性策略只存在一处并保持 `AiAdapter` 接口不变。

### #2 连接探针

- Anthropic 和 Gemini 改用 `buildAnalysisProbePrompt()`、生产分析 Schema 与
  `parseAnalysisText()`。
- 删除只服务于弱 `{ok:true}` 契约的 `parseProbeText` 和 `probeJsonSchema`。
- Anthropic 输出预算由 32 调到 256，足以承载代表性六字段结果。

连接验证现在证明“该档案可以完成真实 Siftmark 分析”，而不只是“Endpoint 能返回 JSON”。

### #3 输入安全

- 新增 `sanitizeAiRequestContext()`，统一清除 URL username、password、query 和 fragment。
- 模型可见文本复用既有敏感信息脱敏；description/pageText 上限为 500/6000 字符，
  候选目录/相关书签上限为 24/5。
- Planner、Coordinator、旧 `SmartBookmarkService` 均在 adapter 边界前调用同一 sanitizer。
- Embedding 文档与查询也统一脱敏，且继续排除 note。

安全边界放在最后一个可信调用点，既防止调用方遗漏，也不改变 provider wire protocol。

### #4 隐私文档

四份文档现在一致说明：完整 Agent 消息保存在本机 IndexedDB；结束和过期只改变状态，
不会自动清空；设置页可删除单条已结束记录，Popup 可清空全部已结束记录；重置或卸载通常清理；
删除会话不会连带删除已学习偏好；发送给模型的候选目录上限是 24。

选择修正文档而非删除历史功能，是因为运行时、测试和设置页都证明本地 Agent 历史是有意能力。

### #5 任务状态

新增共享 `finishAnalyzeBookmarkTask()`，独立 handler 和后台注册入口都按提案状态映射结果。
非失败提案才完成 1 项；失败提案返回 `failed` 并在现有计数上加 1，同时保留 Coordinator
已经持久化的失败提案以供观察。

### 终审修正

双轴 review 首轮发现新增超时/取消英文错误可能原样进入中文设置页，以及 `id@version`
拼接继续重复。`f8574ab` 将相关网络错误中文化，并新增唯一 `modelProfileKey()` 供生产路径复用。
复核后 Standards 与 Spec 两轴均无剩余 finding。

## 分支、提交与合并

| Issue    | 独立开发提交                                     | 主分支合并提交         |
| -------- | ------------------------------------------------ | ---------------------- |
| #1       | `35035ff fix: 接入模型档案限流与自动重试`        | `a21dbef`              |
| #2       | `6ad4aa7 fix: 强化 Anthropic 与 Gemini 连接探针` | `f306ab6`              |
| #3       | `3064ed1 fix: 统一 AI 输入安全边界`              | `50ff5de`              |
| #4       | `b2caf70 docs: 修正 Agent 对话保留说明`          | `c2581a4`              |
| #5       | `d5e42a4 fix: 修正分析任务失败状态`              | `32f57a4`              |
| 终审修正 | `f8574ab fix: 修正模型错误文案与档案键复用`      | 直接在已合并主分支修正 |

各开发任务先给出方案，再在独立分支/worktree 实现并完成定向测试、typecheck、lint 与必要构建。
主代理逐项 review 后按 #1 -> #5 合并，未发现密钥、接口破坏或 issue 外夹带改动。

## 测试与验证

### 最终自动化

| 命令                          | 最终结果                           |
| ----------------------------- | ---------------------------------- |
| `pnpm typecheck`              | 通过                               |
| `pnpm lint`                   | 通过                               |
| 定向终审回归                  | 7 个文件、27/27 项通过             |
| `pnpm test -- --reporter=dot` | 100 个文件、333/333 项通过         |
| `pnpm build`                  | 通过，Chrome MV3，5.93 MB          |
| `pnpm test:e2e`               | 25/25 通过，单 worker，约 1.1 分钟 |
| `git diff --check`            | 通过                               |

### Computer-Use

真实 Chrome for Testing 加载 `.output/chrome-mv3` 后完成模型连接、两次原生收藏、一次固定
503 自动恢复、Agent 历史和使用统计检查。结果包括：

- 连接验证显示“文本、结构化输出”通过。
- 两次收藏均显示“书签已保存 · 分析完成 · 7 / 7”。
- Agent 记录页显示 2 条本地完整会话及本地保留说明。
- 使用统计显示 connection-test success、classify success、classify provider、
  classify success，共 4 个物理请求。
- provider 的 4 个请求均不含固定凭据、`token=` 或 URL fragment 标记。

系统在操作完成后进入 `LockApp`，收尾没有尝试解锁或读取凭据；证据采用锁屏前操作结果、
锁屏后仍可读取的 UIA 语义树和本地 provider 日志，不把无关的新标签页截图冒充功能截图。

## 遗留风险与建议

以下均未达到本轮另立 issue 的证据或范围门槛，但应保留：

1. `LocalCaptureExecutor` 批处理中途失败可能留下部分原生书签变更，失败会话也可能没有完整可用的撤销批次。后续若能构造稳定复现，应优先设计逐项补偿或事务式操作日志。
2. limiter 在退避期间收到取消会立即向调用方返回，但内部 slot 要等退避 Promise 结束才释放，最坏 30 秒。当前不会继续发请求，影响仅是短时吞吐；可补取消感知 delay。
3. Anthropic 没有原生 JSON Schema 约束，仍依赖完整 prompt 和本地严格解析；这是协议能力差异，不应伪装成强保证。
4. 脱敏只识别当前已定义的 API Key、JWT、Bearer、密码、邮箱和手机号模式，无法推断任意业务自定义 secret。Embedding 文本本轮也没有新增长度上限，以免改变检索语义。
5. Side Panel 焦点用例曾在并发执行基线门禁时偶发失败一次，独立复跑、最终全量 Vitest 和 E2E 均通过。若再次出现，应收集稳定时序证据后再立项。
6. 本轮没有把模型正文或完整请求写入证据；后续测试也应继续只记录结构、计数和脱敏后的摘要。

## 交付物

- `docs/reports/2026-08-16-ai-agent-assessment.md`：现状架构、能力清单、代码证据、issue 与任务拆分。
- `docs/testing/evidence/2026-08-17-ai-agent-validation.md`：自动化门禁、固定用例、Computer-Use UIA/provider 证据和逐 issue 验收矩阵。
- `docs/reports/2026-08-17-ai-agent-delivery.md`：本报告。

仓库主分支本地完成合并；未执行远端代码推送。GitHub issue 在最终报告提交并回写验收证据后关闭。
