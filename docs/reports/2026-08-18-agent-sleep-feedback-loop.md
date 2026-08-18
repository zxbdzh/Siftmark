# Agent 睡眠回顾反馈闭环报告

日期：2026-08-18

## 结论

本轮针对“Agent 睡眠功能没有体现实际效果”完成了从代码调研、立项、开发到测试验证的闭环。睡眠回顾现在可以跨批次累积证据，学习记忆与规划器使用同一套逻辑路径，后续 Agent 记录会明确展示记忆是已采用、已避开还是未采用。

## 现状评估摘要

```text
Ctrl+D / Popup / Side Panel / 批量入口
                 |
          CaptureAgent
                 |
        SmartCapturePlanner ---- CapturePreferenceRepository
                 |                         |
             AiAdapter              IndexedDB memories
                 |
          CaptureSleepReviewService
                 |
     resolved sessions -> review candidates -> learned memories
                 |
       Options: 学习状态 / 记忆列表 / Agent 历史采用结果
```

调研确认项目已有本地 Agent 会话、睡眠回顾、弱偏好、模型适配器和本地执行器；本轮没有引入新依赖，也没有改变 Agent 对外消息接口。实际短板由以下代码证据支撑：

- `src/capture-agent/sleep-review.ts` 原先只把当前批次交给模型，跨批次的 `no-pattern` 结果不会进入后续候选池。
- `src/capture-agent/smart-planner.ts` 的目录候选已去除浏览器根目录，而旧学习记忆仍可能保存包含根目录的路径，导致偏好排序无法命中。
- `CapturePlan` 原先没有记录记忆命中/采用结果，`AgentHistorySection` 只能显示最终目录，用户无法判断睡眠记忆是否生效。

## Issue 清单

| Issue | 优先级 | 立项依据 | 本轮验收 |
| --- | --- | --- | --- |
| [#6 统一 Agent 学习记忆与候选目录的路径语义](https://github.com/zxbdzh/Siftmark/issues/6) | P0 | 真实 `CapturePlan.destination.path` 含浏览器根目录，Planner 候选路径不含根目录，旧记忆无法命中 | 旧根路径记忆可续写；合法的同名子目录不被误剥离；重名目录优先用 `destinationFolderId` 判断采用 |
| [#7 让睡眠回顾跨批累计证据并保持来源归属](https://github.com/zxbdzh/Siftmark/issues/7) | P0 | 回顾只累计当前批次，且提交时没有防止会话在模型分析期间变化 | 两个批次各含 1 条同规律结果即可学到记忆；每条来源只关联实际支持它的 memory ID；源会话变化时事务拒绝提交 |
| [#8 显示睡眠记忆对后续归类的命中与采用结果](https://github.com/zxbdzh/Siftmark/issues/8) | P1 | 记忆只影响排序和提示词，用户看不到命中、采用或被模型覆盖 | `CapturePlan.memoryInfluence` 留存命中和采用 ID；设置页可跳转 Agent 记录；避开型记忆显示“已避开” |

## 关键改动

- `sleep-review.ts`
  - 新增跨批候选池，优先选择能形成稳定规律的最新结果和最少旧证据。
  - 统一学习路径归一化，兼容旧版“书签栏/...”记忆。
  - 每条回顾写入 `sourceUpdatedAt`，与事务内当前会话版本校验，避免过期模型结果覆盖新决策。
  - 记忆 ID 按域名、动作、逻辑路径区分，冲突路径不会静默覆盖。
- `learning-repository.ts`
  - `commit` 改为按 session 写入独立 review 结果，保留真实来源归属。
  - 新增 `listReviewCandidates`，允许 `no-pattern` 会话继续参与后续证据累计。
- `smart-planner.ts`
  - 统一最多 8 条有效偏好用于候选排序、提示词和审计记录，避免第 9 条记忆影响结果却不出现在历史中。
  - 有目录 ID 时优先用 ID 判断采用；无 ID 时再比较逻辑路径。
  - 旧路径仅在完整路径无法匹配、去根后能唯一匹配时兼容，避免误删合法同名目录。
- `AgentHistorySection.tsx` / `CaptureLearningSection.tsx` / `options.css`
  - Agent 历史显示命中记忆的证据量及采用状态；避开型记忆显示“已避开/未避开”。
  - 采用项优先展示，并对剩余记忆给出数量提示。
  - 增加“查看采用记录”入口、焦点样式、窄屏换行；hash 切页时重置主滚动位置。

## 验证证据

- 全量 Vitest：`101` 个测试文件、`341` 项测试全部通过。
- 新增闭环回归：跨批证据、旧根路径续写、冲突路径、过期会话事务、重名目录 ID、避开型记忆 UI 均有断言。
- TypeScript：`tsc --noEmit` 通过。
- ESLint：全仓通过。
- 生产构建：`pnpm build` / WXT Chrome MV3 构建通过。
- 扩展 E2E：`tests/e2e/agent-history-and-sleep-review.spec.ts` 两个场景通过，包含“已采用睡眠记忆”历史断言和 390px 无横向溢出检查。Playwright 测试进程在通过后因机器上已有大量 Chromium 进程，清理阶段超时退出；用例本身均为 passed。
- `agent-browser`：按项目约定执行了 CLI/doctor 检查并尝试启动独立会话；当前机器 Chrome 启动阶段持续卡住，未能取得截图。该环境限制不影响单元、构建和扩展 E2E 结果，后续应在干净浏览器进程环境补拍设置页和 Agent 历史截图。

## 遗留风险与建议

- 多个浏览器根目录下存在完全相同的逻辑路径时，模型输入仍可能看到重复显示路径；当前采用判断已用目录 ID 防止误报，后续可考虑为重复路径增加根目录 disambiguation。
- 旧版本错误的 `learningReview.memoryIds` 不做自动迁移；新写入记录已按来源隔离，历史错误数据只会影响候选资格，不会再扩散到新记忆。
- 睡眠回顾仍受 12 小时冷却和批次上限约束，这是成本控制策略；设置页会显示本次待处理数量和最近尝试结果。
