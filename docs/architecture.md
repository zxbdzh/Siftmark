# Siftmark 架构说明

## 系统边界

Siftmark 是单个 Manifest V3 扩展，没有账号、云数据库或 Siftmark 服务端。外部系统只有 Chromium API 与用户主动配置的模型 Endpoint。

```text
Popup / Manager / Options / Content
                |
          domain services
                |
  browser ports + persistence ports
          |                 |
 chrome.bookmarks      IndexedDB / storage.local
          |
 Chromium native bookmark tree (source of truth)
```

UI 不直接跨模块修改 Chrome API 或数据库表。入口负责组装，领域模块定义行为，`src/platform/chrome` 和 `src/storage` 实现端口。

## 入口职责

| 入口                        | 职责                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `entrypoints/background.ts` | 持久任务、恢复、书签事件、模型调用、截图、健康调度、通知、右键和快捷命令 |
| `entrypoints/popup`         | 当前页/标签页保存、重复处理、进度、撤销和管理器入口                      |
| `entrypoints/manager`       | 原生树、虚拟列表、详情、搜索、审核、草稿、通知与统计                     |
| `entrypoints/options`       | 引导、模型、规则、权限、外观、特殊文件夹、备份、无痕状态和重置           |
| `entrypoints/content.ts`    | 当前页提取、采集策略、悬浮按钮和选中页交互                               |

## 领域模块

- `bookmarks`：`BookmarkRepository`、保存、归档、回收与特殊文件夹。
- `operations`：带前后快照和幂等键的变更日志、单项/批量撤销。
- `tasks`：持久队列、认领、终态、取消和 Worker 恢复。
- `ai`：模型档案、协议适配、提示词、Schema、脱敏、网络错误和审核提案。
- `rules`：本地优先匹配与终止动作。
- `capture`：页面政策、12,000 字符截断、可见区域截图和本地缩略图。
- `search`：可重建关键词索引、筛选、语义向量与融合排序。
- `health`：URL 规范化、重复、链接状态和本地访问聚合。
- `backup`：原生/HTML/MarkAI 解析、冲突计划、恢复点、校验和与加密容器。
- `notifications`：应用内记录和隐私化浏览器汇总。

## 数据所有权

`chrome.bookmarks` 唯一拥有书签标题、URL、父子关系、同级索引和文件夹树。任何业务动作都重新读取目标书签并进行冲突检查。

`chrome.storage.local` 保存模型档案（含 API Key）、能力分配、主题/密度、规则、特殊文件夹 ID、引导状态、悬浮按钮、通知/统计偏好和小型运行设置。项目不使用 `chrome.storage.sync`。

IndexedDB 数据库 `siftmark`（Schema v4）包含：

| Store                     | 所有内容                                 | 可重建/保留说明                     |
| ------------------------- | ---------------------------------------- | ----------------------------------- |
| `bookmarkMetadata`        | 标签、摘要、笔记、置信度、理由、健康状态 | 由书签 ID 关联                      |
| `thumbnails`              | WebP Blob、尺寸、哈希、状态              | 缓存，可清理                        |
| `operationLog`            | 变更前后值、批次、幂等键                 | 撤销依据                            |
| `tasks`                   | 输入快照、档案版本、状态和进度           | Worker 恢复依据                     |
| `searchIndex`             | 关键词文档或版本化向量                   | 完全可重建                          |
| `notifications`           | 应用内通知                               | 30 天且最多 500 条                  |
| `aiUsageLog`              | 模型、任务、Token、耗时、状态            | 90 天且最多 1,000 条，不含正文/密钥 |
| `softDeletedMetadata`     | 删除书签的扩展元数据                     | 恢复/清理用途                       |
| `visitAggregates`         | 次数、最近访问、日桶                     | 90 天聚合                           |
| `analysisProposals`       | 来源快照、结构化建议和审核状态           | 不保存原始正文                      |
| `importRecoveryPoints`    | 导入前原生节点与元数据快照               | 失败恢复                            |
| `specialFolderPlacements` | 归档/回收原位置                          | 恢复原位置                          |

## 保存与分析序列

1. Popup 读取当前标签页和原生书签树，进行 URL 重复预览。
2. `SaveService` 先调用 `chrome.bookmarks.create`。
3. 写入操作日志并立即向 UI 返回已保存状态。
4. 后台分别排队 `analyze-bookmark` 与 `capture-thumbnail`；任何失败都不撤销书签。
5. 分析协调器读取最新书签、执行本地规则、选择已验证档案并发送受控提示。
6. 响应经严格 Schema 校验，形成审核提案；字段应用前再次做冲突检查。

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
- 页面正文最多 12,000 字符，只存在于当前请求内存；密码/支付/黑名单策略可完全阻止采集。
- 邮箱、手机号、常见密钥、JWT、Bearer Token 和密码字段在发出前本地脱敏。
- 模型只能返回固定 Schema，不能修改 URL、执行代码或扩展权限。
- 普通备份剔除 API Key；完整配置只能进入带认证加密的容器。
- 无远程字体、动画、Favicon、遥测或分析 SDK。

## 扩展点

新增服务商时优先复用协议：在 `src/ai/profiles/presets.ts` 增加名称、协议、Endpoint 和默认模型即可。新增存储或任务类型必须同时定义所有权、迁移、清理、幂等性、恢复和备份行为。
