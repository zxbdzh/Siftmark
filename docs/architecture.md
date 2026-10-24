# Siftmark 架构说明

## 系统边界

Siftmark 是单个 Manifest V3 扩展，没有账号、云数据库或 Siftmark 服务端。外部系统只有 Chromium API 与用户主动配置的模型 Endpoint。

```text
Native bookmark / Command / Context menu
                  |
             CaptureAgent
      plan -> assess -> route -> execute
        |                         |
 user model endpoint       local executor
        |                         |
  Web overlay / Side Panel / Popup queue
                  |
 chrome.bookmarks + IndexedDB / storage.local
                  |
 Chromium native bookmark tree (source of truth)
```

UI 不直接跨模块修改 Chrome API 或数据库表。入口负责组装，领域模块定义行为，`src/platform/chrome` 和 `src/storage` 实现端口。

## 入口职责

| 入口                        | 职责                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `entrypoints/background.ts` | 持久任务、恢复、书签事件、模型调用、截图、健康调度、通知、右键和快捷命令 |
| `entrypoints/popup`         | 待处理收藏、最近结果、允许/拒绝、撤销和管理器入口                        |
| `entrypoints/manager`       | 原生树、虚拟列表、详情、搜索、审核、草稿、通知与统计                     |
| `entrypoints/options`       | 引导、模型/Agent 分配、固定规则、权限、特殊文件夹、备份和重置            |
| `entrypoints/content.ts`    | 当前页按需提取与事件触发的审批/结果浮层                                  |
| `entrypoints/sidepanel`     | 当前方案、风险原因、持久对话、允许/拒绝、重试和撤销                      |

## 领域模块

- `bookmarks`：`BookmarkRepository`、保存、归档、回收与特殊文件夹。
- `operations`：带前后快照和幂等键的变更日志、单项/批量撤销。
- `tasks`：持久队列、认领、终态、取消和 Worker 恢复。
- `ai`：模型档案、协议适配、提示词、Schema、脱敏、网络错误和审核提案。
- `rules`：本地优先匹配与终止动作。
- `capture`：页面政策、12,000 字符截断、可见区域截图和本地缩略图。
- `capture-agent`：收藏会话、结构化方案、严格风险策略、偏好学习、本地执行和生命周期。
- `search`：可重建关键词索引、筛选、语义向量与融合排序。
- `health`：URL 规范化、重复、链接状态和本地访问聚合。
- `backup`：原生/HTML/MarkAI 解析、冲突计划、恢复点、校验和与加密容器。
- `notifications`：应用内记录和隐私化浏览器汇总。

## 数据所有权

`chrome.bookmarks` 唯一拥有书签标题、URL、父子关系、同级索引和文件夹树。任何业务动作都重新读取目标书签并进行冲突检查。

`chrome.storage.local` 保存模型档案（含 API Key）、能力分配、主题/密度、规则、特殊文件夹 ID、引导状态、通知/统计偏好和小型运行设置。项目不使用 `chrome.storage.sync`。

IndexedDB 数据库 `siftmark`（Schema v5）包含：

| Store                     | 所有内容                                       | 可重建/保留说明                                                                     |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `bookmarkMetadata`        | 标签、摘要、笔记、置信度、理由、健康状态       | 由书签 ID 关联                                                                      |
| `thumbnails`              | WebP Blob、尺寸、哈希、状态                    | 缓存，可清理                                                                        |
| `operationLog`            | 变更前后值、批次、幂等键                       | 撤销依据                                                                            |
| `tasks`                   | 输入快照、档案版本、状态和进度                 | Worker 恢复依据                                                                     |
| `searchIndex`             | 关键词文档或版本化向量                         | 完全可重建                                                                          |
| `notifications`           | 应用内通知                                     | 30 天且最多 500 条                                                                  |
| `aiUsageLog`              | 模型、任务、Token、耗时、状态                  | 90 天且最多 1,000 条，不含正文/密钥                                                 |
| `softDeletedMetadata`     | 删除书签的扩展元数据                           | 恢复/清理用途                                                                       |
| `visitAggregates`         | 次数、最近访问、日桶                           | 90 天聚合                                                                           |
| `analysisProposals`       | 来源快照、结构化建议和审核状态                 | 不保存原始正文                                                                      |
| `importRecoveryPoints`    | 导入前原生节点与元数据快照                     | 失败恢复                                                                            |
| `specialFolderPlacements` | 归档/回收原位置                                | 恢复原位置                                                                          |
| `captureSessions`         | 收藏快照、方案、风险、消息、会话状态和操作批次 | 待处理会话通常在 7 天后转为过期；可重试失败、已解决和过期记录留在本机，可由用户删除 |
| `capturePreferences`      | 普通偏好、睡眠回顾记忆与用户固定规则           | 本地结构化信号，不含完整对话                                                        |

## 收藏 Agent 序列

1. `Ctrl+D`、`Ctrl+Shift+S` 或右键入口先创建原生书签；模型或网络失败不删除它。
2. `CaptureAgent.begin` 保存来源快照，裁剪页面上下文并调用已分配的 Agent/分类模型。
3. `SmartCapturePlanner` 把模型响应解析为目录、标题、标签、摘要、置信度和相关项；模型没有写入接口。
4. 风险策略根据新目录、置信度、重复、标题变化、特殊目录、页面信息和陈旧状态确定自动执行或审批。
5. 安全方案由 `LocalCaptureExecutor` 自动写入。风险方案先移动到已配置的待整理箱，再通过网页浮层、Popup 或 Side Panel 等待允许/拒绝。
6. 执行前重新读取书签与目录；移动、改名、目录创建、元数据和精确重复合并写入同一操作批次，可确定性撤销。
7. 用户在 Side Panel 调整时只替换当前方案。明确表达“以后都……”才生成可见固定规则；普通反馈仅在单独启用本地学习后作为短期证据。

## Agent 本地学习与有界复盘

`AgentExperienceService` 复用 `capturePreferences` 保存带来源、置信度、更新时间与有效期的结构化证据和经验，`captureSessions` 保留短期任务上下文与主动发现的待确认方案。只有显式收藏确认、拒绝、撤销、Siftmark 内分类调整和检索后选择属于学习来源；自动执行结果和网页文本不直接升级为长期规则。普通经验需两个不同书签的一致反馈，用户纠正优先，反向反馈使旧经验失效。

授权切换、写入、纠错、删除、清空和复盘通过同源 Web Locks 串行；证据稳定 ID 防重，清空推进授权时间和代次。后台恢复补录已授权会话的最终反馈，按原生书签和持久操作日志恢复中断的主动方案。发现不一致时停在可撤销或结束的失败状态，不盲目重放移动。学习数据始终本地使用，不再调用模型提炼学习记录；旧睡眠回顾实现保留作历史接口兼容。

Chromium `idle` 与每 5 分钟的 alarm 唤醒只在明确授权主动检查后生效；每 12 小时最多一轮、扫描最多 200 个原生书签、最多保留 3 个待确认方案。方案写入既有会话仓库，用户确认后使用本地执行器，仅调整位置，不改标题或元数据；批次 ID 确定，可撤销。分类、关联候选与检索排序使用本地经验；整批整理只能在已校验的固定分类树内调整归属，随后重新校验并等待原有整批确认。

状态和安全不变量详见 [收藏 Agent 设计](design/2026-08-11-capture-agent.md)。

## 任务恢复

任务写入 IndexedDB 后才启动 drain。`claimNext` 在 Dexie 读写事务中把最早的 `queued` 任务原子改为 `running`，防止两个执行器重复认领。

Worker 启动时扫描 `running`：

- 本地幂等任务回到 `queued` 并继续执行。
- `analyze-bookmark` 和兼容旧数据的 `ai-request` 转为 `unknown`，不自动重复可能已计费的请求。
- `cancelled` 和其他终态保持不变。

任务 ID 和幂等键不因恢复改变。1,000 任务实测见 [性能基线](testing/performance-baseline.md)。

## 搜索与性能

管理器从原生树和元数据生成 `SearchDocument`。同步器先重建内存索引，再用 Dexie `bulkPut`/`bulkDelete` 批量持久化变化；完整索引仍可随时删除重建。列表和文件夹树使用 TanStack Virtual，只挂载视口和 overscan 行。

语义向量以 `[embeddingProfile+vectorVersion+dimensions]` 隔离。语义不可用、版本不匹配或请求失败时回退本地搜索。

## 安全边界

- Endpoint 只允许 HTTPS，环回地址例外。
- 收藏 Agent 最多发送 6,000 字符正文；密码/支付/黑名单策略可完全阻止采集。
- URL 在发送前移除用户名、密码、查询参数与片段；单条收藏不会发送完整书签库、私密备注或完整对话历史。
- 全量整理会分批发送全部可整理书签的 ID、标题和脱敏 URL，统一规划分类及归属；不读取网页正文，不发送原目录、私密笔记或健康记录。
- 全量整理先完成本地 HTML 备份和整批校验，再等待用户确认分类方案；确认后才创建目录和移动。管理器页面驱动任务，关闭页面会中断后续处理，已完成的改动不会自动撤销。
- 邮箱、手机号、常见密钥、JWT、Bearer Token 和密码字段在发出前本地脱敏。
- 模型只能返回固定 Schema，不能修改 URL、执行代码、调用 Chrome API 或扩展权限。
- 普通备份剔除 API Key；完整配置只能进入带认证加密的容器。
- 无远程字体、动画、Favicon、遥测或分析 SDK。

## 扩展点

新增服务商时优先复用协议：在 `src/ai/profiles/presets.ts` 增加名称、协议、Endpoint 和默认模型即可。新增存储或任务类型必须同时定义所有权、迁移、清理、幂等性、恢复和备份行为。
