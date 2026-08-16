# AI Agent 合并后验证证据

- 日期：2026-08-17
- 最终功能提交：`f8574ab`（相对固定点 `51568f6`）
- 测试环境：Windows、Chrome for Testing `151.0.7922.34`、Siftmark `0.1.3`

## 自动化门禁

所有功能分支合并后统一执行，未在开发分支中把局部结果当作最终验收。

| 门禁                          | 结果                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| `pnpm typecheck`              | 通过                                                                |
| `pnpm lint`                   | 通过                                                                |
| `pnpm test -- --reporter=dot` | 100 个测试文件，333/333 通过                                        |
| `pnpm build`                  | 通过，生成 Chrome MV3 生产构建，约 5.93 MB                          |
| `pnpm test:e2e`               | 25/25 通过；`test-results/.last-run.json` 为 `passed`，失败列表为空 |
| `git diff --check`            | 通过                                                                |

调研基线为 96 个测试文件、312/312 个测试通过；本轮净增 4 个测试文件和 21 个测试。

## Computer-Use 固定用例

### 环境与操作路径

1. 在 Orca 固定终端启动 `tests/e2e/fixtures/provider-server.ts`，监听
   `127.0.0.1:43173`。
2. 使用独立 profile `F:\github\Siftmark-computer-use-20260816` 启动真实
   Chromium，从 `.output/chrome-mv3` 加载扩展。
3. 在 `chrome://extensions` 确认 Siftmark `0.1.3` 已加载并启用；测试扩展 ID
   为 `neloflaliidhkkpeejlbhhioiffbcogb`。
4. 打开“设置 -> AI 模型”，配置本地固定模型并测试连接。界面结果为
   `验证通过：文本、结构化输出`。
5. 在本地固定页面触发第一次原生收藏。界面结果为
   `书签已保存 · 分析完成 · 7 / 7`。
6. 将 provider 配为下一次正式分析返回一次 503，再以相同操作触发第二次收藏。
   无人工重试，界面仍得到 `书签已保存 · 分析完成 · 7 / 7`。
7. 打开“设置 -> Agent 记录”和“设置 -> 使用统计”，读取本地会话及物理请求记录。
8. 读取 provider 的 `/__e2e/requests`，只输出路径、用途、字节数和敏感标记扫描，
   不把请求正文写入证据。

### UIA 语义证据

Computer-Use 使用 Windows UIA provider `1.0.0`。锁屏前已完成上述可见操作；系统随后进入
`LockApp`，因此收尾阶段没有伪造或复用无关截图，也没有尝试解锁。无障碍树仍可读取，摘录如下：

```text
Window: "Siftmark 设置 - Google Chrome for Testing"
地址: chrome-extension://neloflaliidhkkpeejlbhhioiffbcogb/options.html#agent
标题: Agent 记录
说明: 每次收藏的对话、分析过程、目录方案与最终结果都保存在本机。
数量: 2 条
记录 1: 本地模型建议标题 / 等待批准 / Ctrl+D / 书签栏 / 测试
记录 2: 本地模型建议标题 / 等待批准 / Ctrl+D / 书签栏 / 测试
```

```text
地址: chrome-extension://neloflaliidhkkpeejlbhhioiffbcogb/options.html#usage
标题: 使用统计 / 本地 AI 用量
请求: 4 次
fixture-model / classify / success
fixture-model / classify / provider
fixture-model / classify / success
fixture-model / connection-test / success
```

第二次收藏对应一条 `provider` 和随后一条 `success`，证明 503 由生产注册表中的自动重试恢复；
每个物理请求都单独计量。

### Provider 请求摘要

`/__e2e/requests` 共记录 4 个 POST：

| 序号 | 路径                   | 用途                   | 请求体字节 | 固定敏感标记 |
| ---: | ---------------------- | ---------------------- | ---------: | ------------ |
|    1 | `/v1/chat/completions` | connection-test        |       3247 | 均未出现     |
|    2 | `/v1/chat/completions` | classify               |       3181 | 均未出现     |
|    3 | `/v1/chat/completions` | classify，首次 503     |       3278 | 均未出现     |
|    4 | `/v1/chat/completions` | classify，自动重试成功 |       3278 | 均未出现     |

对所有请求序列化后扫描 `topsecret`、`retrysecret`、`token=` 和 URL fragment 固定标记，
结果全部为 `false`。这同时验证正式分析请求经过统一 URL 清理与文本脱敏边界。

## Issue 验收矩阵

| Issue                   | 验收证据                                                                                                                                                              | 结果 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| #1 档案限流、重试、取消 | wrapper/HTTP/limiter 单元测试覆盖并发 2、`id@version` 隔离、最多 2 次重试、非重试错误、预取消不 fetch、物理重试计量；固定 E2E 21/21；Computer-Use 的一次 503 自动恢复 | 通过 |
| #2 六字段连接探针       | Anthropic/Gemini 单元测试验证完整六字段、严格本地解析及旧 `{ok:true}` 拒绝；`model-profile` E2E 以真实 MV3 扩展验证四种协议请求形状                                   | 通过 |
| #3 统一输入安全边界     | sanitizer、Planner、Coordinator、旧批量服务、Embedding 文档与查询均有端口捕获测试；Computer-Use provider 的 4 个请求不含固定凭据、query 或 fragment 标记              | 通过 |
| #4 隐私披露             | 四份文档的保留、删除路径和 24 个候选目录表述一致；Computer-Use 的 Agent 记录页明确显示 2 条本机会话及本地保留说明                                                     | 通过 |
| #5 失败提案任务状态     | 集成测试覆盖 `pending -> succeeded`、`failed -> failed`、失败计数从 2 增至 3及正文 finally 清理；两个入口复用同一状态映射函数                                         | 通过 |

## 可复核入口

- 自动化结果：`test-results/.last-run.json`
- 固定 provider：`tests/e2e/fixtures/provider-server.ts`
- 协议验收：`tests/e2e/model-profile.spec.ts`
- 重试验收：`tests/e2e/bulk-and-undo.spec.ts`
- 现状与立项证据：`docs/reports/2026-08-16-ai-agent-assessment.md`
