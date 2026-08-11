# Siftmark 开发指南

## 环境

- Node.js `>=22 <23`
- pnpm `10.15.0`（由 `packageManager` 固定）
- Chrome 或 Edge 的当前稳定版；自动化使用 Playwright Chromium
- Windows PowerShell 命令可直接按本文执行

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

生产扩展位于 `.output/chrome-mv3`。开发服务器使用 `pnpm dev`；修改 manifest、后台入口或权限后应重新加载扩展。

## 代码边界

- `entrypoints/`：WXT 入口与依赖组装，不承载可复用领域逻辑。
- `src/bookmarks`、`operations`、`tasks`、`rules`、`ai`、`capture`、`search`、`health`、`backup`：领域服务与端口。
- `src/platform/chrome`：Chrome API 适配器。
- `src/storage`：Dexie Schema、迁移和 Repository。
- `src/ui`：React 视图和交互。
- `tests/unit`：纯逻辑和组件公开行为。
- `tests/integration`：跨 Repository/服务边界，使用 fake-indexeddb 或受控适配器。
- `tests/e2e`：构建后的真实 MV3 扩展。

原生书签是唯一事实源。不要把完整书签树复制到 IndexedDB，也不要从 UI 直接写 Dexie 表；通过领域服务和 Repository 执行。API Key 只能进入 `chrome.storage.local`，不能进入 sync、日志、测试附件、命令参数或源码。

## 常用门禁

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test --coverage
pnpm build
$env:PLAYWRIGHT_HTML_OPEN = 'never'
pnpm test:e2e
```

运行单个测试：

```powershell
pnpm exec vitest run tests/unit/search/search-service.test.ts
pnpm exec playwright test tests/e2e/save-and-review.spec.ts --reporter=line
```

Playwright 配置先执行 `pnpm build`，再启动本地 `127.0.0.1:43173` 页面/模型夹具。每个测试使用独立临时 Chromium profile，并从 `.output/chrome-mv3` 加载扩展。`siftmark.test` 映射到环回地址；测试不得依赖真实供应商、API Key 或外网。

## 数据库与迁移

数据库名为 `siftmark`，当前 Schema 版本为 4。新增或修改表时：

1. 更新 `src/storage/schema.ts` 类型。
2. 在 `src/storage/migrations.ts` 增加版本和索引定义，不重写旧版本。
3. 通过 `SiftmarkDatabase` 暴露 Table。
4. 添加迁移、Repository 和重启恢复测试。
5. 明确保留/清理策略及备份兼容性。

搜索索引可重建，书签数据不可由索引反向恢复。大批量 IndexedDB 写入使用 `bulkPut`/`bulkDelete` 或明确分片，避免阻塞 Popup 的操作日志写入。

## 任务安全

任务先持久化为 `queued`，再由 `TaskRunner` 认领。Service Worker 启动时：

- 可安全重放的本地任务从 `running` 返回 `queued`。
- `analyze-bookmark` 等可能已产生计费副作用的任务转为 `unknown`，必须由用户决定是否重试。
- 幂等键在重启前后保持不变。

新增任务类型时必须明确它是否幂等、取消语义、终态、进度字段和恢复策略，并为 Worker 重启写测试。

## 模型适配器

四个协议适配器都实现 `AiAdapter`，共享严格分析 Schema 和 HTTP 错误映射。新增服务商预置通常只需修改 `src/ai/profiles/presets.ts`，选择现有协议并填写 Endpoint/默认模型；不要为品牌复制适配器。

只有服务商的 wire protocol 与现有四类均不兼容时才新增协议。新增协议必须包含连接探测、分析请求、响应校验、认证头脱敏、超时/中止和必要的 Embedding 测试。详见 [模型协议](model-protocols.md)。

## UI 与资产

- 使用现有设计 Token、Lucide 图标、本地 Noto Sans SC/Space Grotesk 和本地 Lottie。
- 不引入远程字体、图标、Favicon、动画或分析脚本。
- 长列表必须虚拟化；固定格式控件需稳定尺寸。
- 新视图至少验证键盘焦点、语义标签、严重/关键 axe 规则、800px 窄屏和减少动态效果。

## 提交与发布准备

提交信息使用中文 Conventional Commits，例如：

```text
feat: 增加模型预置
fix: 避免重启后重复分析
docs: 更新备份恢复说明
```

不要提交 `.output`、测试临时 profile、真实密钥或本地报告。发布只能在完整门禁、Chrome/Edge 人工清单和校验和验证全部通过后进行。
