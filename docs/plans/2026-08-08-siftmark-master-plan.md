# Siftmark Implementation Master Plan

> **For agentic workers:** Execute the linked phase plans in order. Do not use Superpowers skills. Track every checkbox, run each stated verification command, and stop at each phase review gate before continuing.

**Goal:** Build and package the complete Siftmark Chromium extension defined in `docs/design/2026-08-08-siftmark-design.md`.

**Architecture:** One WXT React/TypeScript extension with domain modules behind browser and persistence ports. Chromium bookmarks remain authoritative; IndexedDB stores Siftmark metadata and durable work queues; model calls go directly to user-configured endpoints.

**Tech Stack:** Node.js 22, pnpm 10, WXT, React, TypeScript, Dexie, Zod, Zustand, TanStack Virtual, MiniSearch, JSZip, Web Crypto, Vitest, fake-indexeddb, Testing Library, Playwright.

## Global Constraints

- Target Chrome, Edge, Brave, and Arc using Manifest V3.
- The first UI release is Simplified Chinese only.
- Use `#111111` for brand structure and `#B7FF36` only for brand and AI activity accents.
- Native bookmarks are the only source of truth for title, URL, parent, order, and folder hierarchy.
- Store API keys only in `chrome.storage.local`; never place them in sync storage, logs, fixtures, command arguments, or source control.
- Never retain extracted page body text after its current model request completes.
- Never upload telemetry or call third-party font, favicon, animation, or analytics CDNs.
- Do not copy MarkAI source, copy, layout, or assets.
- Use Chinese Conventional Commits for every repository commit.
- Do not mark a phase complete until its tests, build, and manual review gate pass.

## Locked File Structure

```text
Siftmark/
├── assets/
│   ├── fonts/
│   ├── icons/
│   └── lottie/
├── entrypoints/
│   ├── background.ts
│   ├── content.ts
│   ├── manager/
│   │   ├── App.tsx
│   │   ├── index.html
│   │   └── main.tsx
│   ├── options/
│   │   ├── App.tsx
│   │   ├── index.html
│   │   └── main.tsx
│   └── popup/
│       ├── App.tsx
│       ├── index.html
│       └── main.tsx
├── src/
│   ├── ai/
│   │   ├── adapters/
│   │   ├── profiles/
│   │   ├── prompts/
│   │   ├── schemas/
│   │   └── security/
│   ├── backup/
│   ├── bookmarks/
│   ├── capture/
│   ├── health/
│   ├── notifications/
│   ├── operations/
│   ├── platform/chrome/
│   ├── rules/
│   ├── search/
│   ├── storage/
│   ├── tasks/
│   ├── ui/
│   └── utils/
├── tests/
│   ├── e2e/
│   ├── fixtures/
│   ├── integration/
│   └── unit/
├── docs/
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── vitest.config.ts
└── wxt.config.ts
```

## Stable Cross-Phase Interfaces

The following names are contracts. Later phase plans must consume these exact interfaces.

```ts
export type BookmarkId = string;

export interface BookmarkNode {
  id: BookmarkId;
  parentId: BookmarkId;
  index: number;
  title: string;
  url?: string;
  dateAdded?: number;
}

export interface BookmarkRepository {
  get(id: BookmarkId): Promise<BookmarkNode | null>;
  getTree(): Promise<BookmarkNode[]>;
  create(input: Omit<BookmarkNode, 'id'>): Promise<BookmarkNode>;
  update(id: BookmarkId, patch: Pick<BookmarkNode, 'title'>): Promise<BookmarkNode>;
  move(id: BookmarkId, parentId: BookmarkId, index?: number): Promise<BookmarkNode>;
  remove(id: BookmarkId): Promise<void>;
}

export interface BookmarkMetadata {
  bookmarkId: BookmarkId;
  summary: string;
  tags: string[];
  note: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  reason: string;
  health: 'unchecked' | 'healthy' | 'temporary' | 'dead' | 'restricted' | 'blocked';
  updatedAt: number;
}

export interface DurableTask<TInput = unknown> {
  id: string;
  type: string;
  state: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  input: TInput;
  profileVersion?: string;
  completed: number;
  failed: number;
  retryCount: number;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiAnalysisResult {
  folderPath: string[];
  title: string;
  tags: string[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}
```

## Phase Sequence

| Phase | Plan | Independently testable outcome |
|---|---|---|
| 1 | `2026-08-08-phase-1-foundation-data.md` | Loadable WXT shell, stable domain contracts, IndexedDB schema, Chrome bookmark adapter, operation log, and durable task repository |
| 2 | `2026-08-08-phase-2-ai-automation.md` | Four protocol adapters, model profiles, connection tests, prompts, redaction, rules, structured analysis, and resilient request queue |
| 3 | `2026-08-08-phase-3-interface-workflows.md` | Functional manager, Popup, options, content script, review queue, responsive design system, and accessible interactions |
| 4 | `2026-08-08-phase-4-capture-search-health.md` | Page capture, thumbnails, local/semantic search, duplicate detection, link health, visit aggregates, and notifications |
| 5 | `2026-08-08-phase-5-backup-migration-onboarding.md` | Versioned backup/restore, encrypted key archive, MarkAI migration, onboarding, reset, archive, and recycle bin workflows |
| 6 | `2026-08-08-phase-6-qa-release.md` | Full extension E2E suite, performance and visual gates, user/developer docs, and checksum-recorded Chromium ZIP |

## Phase Gates

- [x] **Gate 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passes and Chrome loads the shell without errors.
- [x] **Gate 2:** Fixture-backed tests pass for all four model protocols; no real credential is committed or logged.
- [ ] **Gate 3:** Popup save, manager edit, review apply, keyboard navigation, light/dark themes, and narrow layout pass Playwright smoke tests.
- [ ] **Gate 4:** Capture, thumbnail cleanup, keyword search, embedding version isolation, duplicate scan, health scan, and notification retention pass integration tests.
- [ ] **Gate 5:** HTML, Siftmark JSON/ZIP, MarkAI, encrypted archive, conflict preview, onboarding, and reset pass round-trip tests.
- [ ] **Gate 6:** Chrome and Edge manual checklists pass; `dist/siftmark-0.1.0-chromium.zip` and SHA-256 are recorded.

## Commit Sequence

```text
chore: 初始化 WXT 扩展工程
feat: 建立书签领域与本地数据层
feat: 实现持久化任务与可撤销操作
feat: 接入统一模型协议与配置档案
feat: 实现规则引擎与 AI 审核管线
feat: 构建 Siftmark 管理器与快捷入口
feat: 加入采集搜索与健康检查
feat: 完成备份迁移与首次引导
test: 补齐扩展端到端与性能验收
docs: 完善交付文档与构建说明
chore: 打包 Siftmark Chromium 版本
```

## Execution Rule

Begin with Phase 1. At the end of each phase, update this document's gate checkbox in the same commit as the final phase verification. Do not skip forward to UI work before the domain contracts and persistence migrations are green.
