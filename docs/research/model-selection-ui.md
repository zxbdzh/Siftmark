# Research: Siftmark 模型列表与整理前分类模型选择 UI

## Summary
成熟产品把“模型是什么”与“当前能否使用”分开表达：名称/模型 ID 用于识别，能力、上下文、价格、延迟/速度、生命周期和实际可用性用于决策。官方资料同时显示，模型选择器应先暴露少量可比较字段，再把协议、参数、版本、生命周期和验证证据放入详情层；Siftmark 最小实现应以本地 provider/model registry 为真源，支持搜索、能力筛选、状态、最近验证和“全局默认/本次任务覆盖”，并在整理启动前锁定本次任务配置。

## Findings

1. **模型名称应同时展示人类名称与稳定 ID。** OpenAI 的模型文档把模型按推荐用途分成旗舰、平衡智能/成本、低成本高吞吐等，并让用户进入具体模型页；Anthropic 的模型总览同时列出显示名称、API ID、各平台 ID，并明确模型 ID 是可用于调用的标识；OpenRouter 的 Models API 返回 `id`、`canonical_slug` 和 `name`。因此 Siftmark 列表行应显示“显示名 + provider/model ID”，不要只显示一个可变别名。**Sources:** [OpenAI Models](https://platform.openai.com/docs/models), [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview), [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models). **Support:** direct evidence. **Confidence:** high.

2. **能力标签比长描述更适合列表。** Anthropic 总览明确所有当前模型支持文本/图像输入、文本输出、多语言、视觉和工具使用，并在 Models API 的 `capabilities` 中返回 thinking、server tools 等能力；Google Gemini 模型目录按文本、Live、TTS、图像、视频、Embedding、工具/Agent 等任务族分组，并为模型给出简短用途描述；Ollama 官方搜索直接提供 Tools、Thinking、Vision、Embedding、Decision 筛选。Siftmark 可把能力归一化成少量标签：`文本`、`视觉`、`工具调用`、`推理`、`结构化输出`，并将 provider 原始能力保留在详情中。**Sources:** [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview), [Anthropic Models API capabilities](https://platform.claude.com/docs/en/api/models/list), [Google Gemini models](https://ai.google.dev/gemini-api/docs/models), [Ollama model search](https://ollama.com/search?c=tools). **Support:** direct evidence plus clearly labeled normalization inference. **Confidence:** high.

3. **上下文窗口、价格和速度应是可比较的结构化字段。** Anthropic 总览比较表直接列出 comparative latency、输入/输出价格、context window、max output 和 knowledge cutoff；OpenRouter Models API 的模型对象包含 `context_length`、`pricing`、`top_provider.context_length`，并支持按价格、上下文、吞吐和延迟排序；Google 另提供官方 pricing 页面和模型目录。Siftmark 的列表应只显示紧凑摘要，例如“上下文 128K · 价格已知/本地 · 速度相对”，详情抽屉显示输入/输出价格、价格单位、上下文来源与时间。速度必须标为“官方相对速度”或“本地实测”，不能把不同 provider 的延迟混成绝对承诺。**Sources:** [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview), [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models), [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing.md), [Google Gemini models](https://ai.google.dev/gemini-api/docs/models). **Support:** direct evidence; cross-provider comparability limitation is researcher inference. **Confidence:** high.

4. **生命周期状态必须是一等信息。** Google 明确区分 stable、preview、latest、experimental，并说明 latest 会热替换、experimental 不稳定；Anthropic 定义 Active、Legacy、Deprecated、Retired，并说明已退休模型请求会失败；Gemini 目录直接标注 Shut down。Siftmark 应至少支持 `stable/preview/experimental/deprecated/retired`，并将“已验证/草稿”作为另一条独立维度：生命周期是 provider 的状态，验证是 Siftmark 对当前凭据、协议和请求路径的状态。**Sources:** [Google Gemini model version patterns](https://ai.google.dev/gemini-api/docs/models), [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations). **Support:** direct evidence plus product inference. **Confidence:** high.

5. **选择器应采用“搜索 + 少量筛选 + 结果列表 + 详情”结构。** OpenRouter 官方 Models API 支持按自由文本、类别、输入/输出模态、上下文下限、价格上下限、架构、作者、托管 provider、区域、零数据保留和支持参数筛选，也支持按价格、上下文、吞吐、延迟等排序；Ollama 官方搜索按能力筛选；Anthropic 文档建议用 `line` 字段分组模型，而不是从 ID 推断。可落地 UI：顶部搜索；第二行 provider、状态、能力多选；列表默认按“已验证优先、最近使用/最近验证”排序；每行单选并显示显示名、ID、能力标签、状态、上下文/价格摘要；点击详情抽屉。**Sources:** [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models), [Ollama search](https://ollama.com/search?c=tools), [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview). **Support:** direct evidence plus Siftmark UI inference. **Confidence:** high.

6. **任务开始前只显示影响决策和可执行性的字段。** 任务前应显示：模型显示名/ID、provider、Siftmark 验证状态、支持的任务能力、生命周期状态、上下文上限、价格或“本地/未知”、最近验证时间；不应让用户先阅读完整 API 参数表。详情抽屉再显示：完整协议/endpoint、原始 capabilities、输入输出模态、max output、thinking/工具参数、版本或 digest、生命周期日期、验证请求和失败原因、价格来源。依据是官方产品普遍用简短用途/速度/价格/上下文做首层比较，把完整规格放到模型页或 API 对象中。**Sources:** [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview), [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models), [Google AI Studio quickstart](https://ai.google.dev/gemini-api/docs/ai-studio-quickstart?hl=en), [Ollama API list models](https://docs.ollama.com/api/tags). **Support:** source interpretation. **Confidence:** high.

7. **“已验证/草稿”要和 provider 状态分离。** Ollama 本地 API 的 `/api/tags` 返回本机实际可用模型、修改时间、磁盘大小、digest、family、参数规模和量化级别；这说明本地模型列表是环境事实，而不是静态目录。OpenRouter/Anthropic/Google 文档则提供目录元数据，不等于 Siftmark 当前凭据可调用。建议状态模型：`draft`（用户保存但未验证）、`verified`（最近一次最小探测成功）、`failed`（最近探测失败，保留失败原因）、`stale`（超过 TTL 未复验）、`unavailable`（明确不可用/已退休）。只有 `verified` 才应默认出现在“推荐/可执行”组；草稿仍可选择但启动前必须提示并阻止无声失败。**Sources:** [Ollama `/api/tags`](https://docs.ollama.com/api/tags), [Anthropic model lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations), [Google Gemini models](https://ai.google.dev/gemini-api/docs/models). **Support:** direct evidence plus product inference. **Confidence:** high.

8. **协议必须是可见的筛选/详情字段。** 同一模型家族可能通过不同平台 ID 或协议暴露：Anthropic 总览列出 Claude API、Bedrock、Google Cloud、Microsoft Foundry 等 ID；OpenRouter 提供 OpenAI-compatible API；Ollama API 使用本地 HTTP endpoint，并能返回 remote model/remote host。Siftmark 应把 `provider`、`protocol`、`endpoint`、`modelId` 分开存储和显示，列表显示 provider/protocol 小标签，详情展示实际 endpoint 与凭据来源。不要把“Anthropic 模型”与“Anthropic 原生协议”混为一谈。**Sources:** [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview), [OpenRouter API docs](https://openrouter.ai/docs/api/api-reference/models/get-models), [Ollama API](https://docs.ollama.com/api/tags). **Support:** direct evidence plus schema inference. **Confidence:** high.

9. **全局默认与本次任务覆盖应形成清晰的优先级链。** OpenAI 的 workspace 文档明确区分管理员起始模型/用户上次选择与可用模型权限：默认值定义起始体验，不会授予不可用模型访问权；Anthropic 的 Claude UI 允许在当前会话中通过模型选择器切换模型；Google AI Studio 的 Run settings 让用户在当前 prompt 中调整模型参数和工具。对 Siftmark 建议优先级：`本次整理任务覆盖 > 工作区/全局默认 > 内置安全默认`。启动确认区必须显示“本次任务使用：X”，并允许一键恢复全局默认；任务运行记录应保存最终解析出的 provider、protocol、modelId、配置快照，避免全局默认变化后历史任务含义漂移。**Sources:** [OpenAI ChatGPT model defaults and picker](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt), [Google AI Studio quickstart](https://ai.google.dev/gemini-api/docs/ai-studio-quickstart?hl=en), [Anthropic Help Center](https://support.anthropic.com/en/articles/8114491-getting-started-with-claude). **Support:** direct evidence plus Siftmark architecture inference. **Confidence:** high.

10. **模型选择应在整理开始前完成并锁定。** 官方产品把模型选择放在 composer/playground 的当前任务上下文中：OpenAI 说明模型选择出现在 composer；Anthropic 说明当前聊天界面会显示并可切换模型；Google AI Studio 把模型参数和工具放在当前 prompt 的 Run settings。Siftmark 应在“开始整理”前提供选择器，并在确认后将 resolved config 绑定到任务；长批次中不要因为默认设置变化而动态切换。失败时报告“模型调用失败/验证失效”，保留书签原位，供现有全量整理失败保护策略处理。**Sources:** [OpenAI model picker](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt), [Anthropic Help Center](https://support.anthropic.com/en/articles/8114491-getting-started-with-claude), [Google AI Studio quickstart](https://ai.google.dev/gemini-api/docs/ai-studio-quickstart?hl=en). **Support:** source interpretation plus Siftmark-specific inference. **Confidence:** high.

## Contradictions

1. 官方目录的“可用”不是同一层含义：Anthropic/Google/OpenRouter 的目录描述平台或目录能力，Ollama `/api/tags` 描述本机已安装模型。不能用目录存在替代当前凭据/endpoint 验证。**Sources:** [Ollama API](https://docs.ollama.com/api/tags), [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models), [Anthropic model lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations).
2. “速度”不可直接横向等价：Anthropic 给 comparative latency，OpenRouter 提供近期中位性能排序，实际延迟仍取决于 prompt、输出长度、thinking effort 和 provider；本地 Ollama 还受硬件影响。Siftmark 应标来源和测量方式，不要合并为一个无来源分数。**Sources:** [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview), [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models).
3. `latest` 与固定版本存在稳定性冲突：Google 明确 latest 会热替换，而 Anthropic 文档强调 API model ID 是 pinned snapshot。默认配置应优先固定 ID；若允许 alias，必须在 UI 标记为动态别名并记录解析后的实际 ID。**Sources:** [Google Gemini models](https://ai.google.dev/gemini-api/docs/models), [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview).

## Missing evidence

1. 未获取 Siftmark 当前模型 registry/schema 和现有配置页的实际字段，因此建议采用兼容性字段名而不是直接指定已有类型。
2. 官方页面通常没有公开“选择器的完整交互规范”或可复用设计 token；UI 结构建议基于官方页面的信息架构/API 字段，不声称是官方设计系统规范。
3. 各 provider 的实时可用性、账户配额和地区限制不能仅凭公开目录确认，必须通过 Siftmark 凭据下的最小请求验证。

## Recommended minimum implementation

1. **Registry fields:** `provider`, `protocol`, `endpoint`, `modelId`, `displayName`, `status`, `verificationState`, `lastVerifiedAt`, `capabilities[]`, `contextWindow`, `inputPrice`, `outputPrice`, `priceUnit`, `sourceUrl`, `versionOrDigest`。
2. **Selector:** 搜索框 + provider/status/capability 筛选 + 单选结果列表；每行显示显示名、model ID、provider/protocol、能力标签、验证状态、上下文摘要；按已验证优先排序。
3. **Preflight:** 选择后显示一行“将用于本次整理：X”；若草稿/过期/失败，要求显式确认或先验证；验证使用最小、低成本请求并记录时间、协议、模型 ID、错误摘要。
4. **Details drawer:** 完整能力、上下文/价格来源、生命周期、endpoint/protocol、最近验证、失败原因、版本/digest；列表不堆参数。
5. **Precedence and audit:** 本次任务覆盖 > 全局默认 > 内置默认；启动时解析并冻结配置，任务记录保存快照；全局默认变更不回写历史任务。

## Explicitly not recommended

- 不把 provider 目录存在、模型名称或“stable”直接当作 Siftmark 已验证可用。
- 不在列表里展示所有 API 参数、完整价格表或未经来源标注的综合质量分数。
- 不把官方相对速度、OpenRouter 近期性能、本地实测延迟混成一个跨 provider 分数。
- 不默认使用会热替换的 `latest` alias 作为可审计的全局默认；至少显示动态别名并记录实际解析 ID。
- 不让长批次整理过程中随着全局默认变化而切换模型；任务必须使用启动时冻结的配置。

## Sources

- Kept: [OpenAI Models](https://platform.openai.com/docs/models) — 官方模型选择和用途分层。
- Kept: [OpenAI model picker/help](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt) — composer 选择器、默认与可用权限关系。
- Kept: [Anthropic Models overview](https://platform.claude.com/docs/en/models/overview) — 名称/ID、能力、速度、价格、上下文、生命周期字段。
- Kept: [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) — Active/Legacy/Deprecated/Retired 定义和迁移流程。
- Kept: [Anthropic Help Center](https://support.anthropic.com/en/articles/8114491-getting-started-with-claude) — 当前聊天中的模型显示与选择器。
- Kept: [Google Gemini models](https://ai.google.dev/gemini-api/docs/models) — 能力分类、stable/preview/latest/experimental、停用模型。
- Kept: [Google AI Studio quickstart](https://ai.google.dev/gemini-api/docs/ai-studio-quickstart?hl=en) — 当前 prompt 的 Run settings、模型参数与工具。
- Kept: [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing.md) — 官方价格来源。
- Kept: [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models) — 可搜索/筛选/排序的模型元数据 API。
- Kept: [Ollama `/api/tags`](https://docs.ollama.com/api/tags) — 本地模型实际安装状态、digest、大小和量化信息。
- Kept: [Ollama search](https://ollama.com/search?c=tools) — 官方能力筛选入口。

## Next steps

先检查 Siftmark 当前模型配置的 schema 和整理启动入口，把上述 registry 字段映射到现有架构；随后只实现“搜索/筛选/选择/预验证/任务覆盖”这一最小闭环。

## Supervisor coordination

研究已完成，未发现需要阻塞决策的问题。
