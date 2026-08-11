# Siftmark

Siftmark 是面向 Chromium 的本地优先 AI 书签管理器。Chrome/Edge 原生书签始终是标题、URL、文件夹和顺序的唯一事实来源；Siftmark 只在本机保存标签、摘要、笔记、审核提案、索引和任务记录。

当前版本为 `0.1.1`，提供开发者模式构建，不提交 Chrome Web Store 或 Edge Add-ons。

## 安装前须知

生产构建会请求以下必需权限：

- `bookmarks`：读取和修改原生书签。
- `storage`：在扩展本地空间保存设置和模型档案。
- `tabs`：识别当前页、批量保存标签页及捕获当前可见页面。
- `scripting` 与 `<all_urls>`：在获准网页上运行已打包内容脚本、按需提取页面内容和访问用户配置的模型 Endpoint。
- `contextMenus`：提供保存页面、链接、选中文本和打开管理器的右键入口。
- `alarms`：唤醒持久化任务、回收站清理和可选健康检查。
- `sidePanel`：承载收藏 Agent 的持续对话与方案调整。

`notifications` 是可选权限，只在用户开启后台任务汇总通知时请求。拒绝网页访问或通知权限后，原生书签管理、本地搜索、规则和备份仍可使用。

Siftmark 无账号、无自建服务端、无遥测。API Key 以原值保存在 `chrome.storage.local`，不是系统钥匙串；模型请求直接发送到用户配置的服务商。详见 [权限与隐私](docs/privacy-and-permissions.md)。

## 构建与加载

要求 Node.js 22 和 pnpm 10：

```powershell
git clone <repository-url> Siftmark
Set-Location Siftmark
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Chrome：打开 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，定位到 `.output/chrome-mv3`。

Edge：打开 `edge://extensions`，启用“开发人员模式”，选择“加载解压缩的扩展”，定位到同一目录。

安装后点击工具栏图标。首次打开设置页会进入五步引导；每一步均可跳过。未配置模型时原生书签仍会立即保存，AI 整理会保留原位并提示完成配置。

## 核心工作流

- 原生 `Ctrl+D`/浏览器星标是主入口；`Ctrl+Shift+S` 与右键收藏复用同一条 Agent 管线。
- 书签始终先写入 Chromium。安全方案自动归类，风险方案移入已配置的待整理箱并显示网页审批浮层。
- Popup 只显示待处理队列与最近结果；Side Panel 用于和 Agent 调整目录或标题，不提供常驻悬浮按钮。
- 模型只生成结构化方案，本地确定性执行器负责移动、改名、新建目录、重复合并和撤销。
- 管理器提供虚拟化文件夹树与书签列表、详情编辑、本地/语义搜索、审核、草稿、通知和统计。
- 本地规则可按域名、URL、标题和来源文件夹移动、加标签、跳过 AI 或送入待整理箱。
- 特殊文件夹通过原生书签 ID 绑定归档、回收站和待整理箱；删除绑定文件夹会暂停相关流程。
- 备份支持 Siftmark JSON/ZIP、浏览器 Bookmark HTML、MarkAI JSON 导入，以及包含密钥的加密 `.siftmark-backup`。
- 分级重置永不删除浏览器原生书签。

完整操作见 [用户指南](docs/user-guide.md)。

## 开发命令

```powershell
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test --coverage
pnpm build
pnpm test:e2e
pnpm zip
```

端到端测试使用本地确定性页面和模型夹具，不需要真实 API Key，也不应访问外网。开发约定、测试结构和新增模型预置方法见 [开发指南](docs/development.md) 与 [模型协议](docs/model-protocols.md)。

## 文档

- [用户指南](docs/user-guide.md)
- [开发指南](docs/development.md)
- [架构说明](docs/architecture.md)
- [收藏 Agent 设计](docs/design/2026-08-11-capture-agent.md)
- [模型协议](docs/model-protocols.md)
- [备份与恢复](docs/backup-and-restore.md)
- [权限与隐私](docs/privacy-and-permissions.md)
- [性能基线](docs/testing/performance-baseline.md)
- [Chrome 人工验收](docs/testing/manual-chrome.md)
- [Edge 人工验收](docs/testing/manual-edge.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

## 许可

本仓库未授予 Siftmark 源码的开源许可证。第三方代码、字体和素材保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
