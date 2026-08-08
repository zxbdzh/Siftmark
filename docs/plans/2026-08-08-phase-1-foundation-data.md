# Phase 1 Foundation and Data Implementation Plan

> **For agentic workers:** Execute tasks in order without Superpowers skills. Each task ends in a reviewable commit; do not continue while its verification command fails.

**Goal:** Produce a loadable WXT extension shell with stable bookmark contracts, IndexedDB persistence, a Chrome adapter, reversible operations, and durable task recovery.

**Architecture:** Domain code depends on ports, not `chrome.*` or Dexie. Platform and persistence adapters satisfy those ports and are tested with controlled fakes.

**Tech Stack:** WXT, React, TypeScript, Dexie, Zod, Vitest, fake-indexeddb, ESLint, Prettier.

## Global Constraints

- Node.js 22 and pnpm 10.
- Manifest V3 and Chromium only.
- Simplified Chinese UI copy.
- Native bookmarks remain authoritative.
- Chinese Conventional Commits.

---

### Task 1: Scaffold the WXT project and quality commands

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `wxt.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `entrypoints/background.ts`
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.tsx`
- Create: `entrypoints/popup/App.tsx`
- Test: `tests/unit/project-smoke.test.ts`

**Interfaces:**
- Produces: `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` commands.

- [x] **Step 1: Create the failing project smoke test**

```ts
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

describe('project metadata', () => {
  it('identifies the extension as Siftmark', () => {
    expect(pkg.name).toBe('siftmark');
    expect(pkg.private).toBe(true);
  });
});
```

- [x] **Step 2: Create the package manifest and tool configuration**

Use this script surface in `package.json`:

```json
{
  "name": "siftmark",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.15.0",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

Install runtime dependencies `@fontsource-variable/noto-sans-sc`, `@fontsource-variable/space-grotesk`, `@tanstack/react-virtual`, `dexie`, `jszip`, `lottie-react`, `lucide-react`, `minisearch`, `react`, `react-dom`, `zod`, and `zustand`. Install development dependencies `@axe-core/playwright`, `@playwright/test`, `@testing-library/jest-dom`, `@testing-library/react`, `@testing-library/user-event`, `@types/chrome`, `@types/react`, `@types/react-dom`, `@vitest/coverage-v8`, `@wxt-dev/module-react`, `eslint`, `eslint-plugin-react-hooks`, `fake-indexeddb`, `jsdom`, `prettier`, `typescript`, `vitest`, and `wxt`.

- [x] **Step 3: Configure the initial manifest**

Set this WXT manifest contract in `wxt.config.ts`:

```ts
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Siftmark',
    description: 'AI 智能书签管理器',
    default_locale: 'zh_CN',
    permissions: ['bookmarks', 'storage', 'tabs', 'scripting', 'contextMenus', 'alarms'],
    optional_permissions: ['notifications'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Siftmark' },
    incognito: 'spanning'
  }
});
```

- [x] **Step 4: Add the smallest loadable entrypoints**

`background.ts` must only register an install log through a local logger. `popup/App.tsx` must render the product name and a disabled “正在初始化” button so the extension has no fake functional command.

- [x] **Step 5: Install and verify**

Run: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`  
Expected: all commands exit 0 and `.output/chrome-mv3/manifest.json` exists.

- [x] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml wxt.config.ts tsconfig.json vitest.config.ts eslint.config.js .prettierrc.json .gitignore entrypoints tests/unit/project-smoke.test.ts
git commit -m "chore: 初始化 WXT 扩展工程"
```

### Task 2: Define bookmark and metadata domain contracts

**Files:**
- Create: `src/bookmarks/types.ts`
- Create: `src/bookmarks/ports.ts`
- Create: `src/storage/types.ts`
- Create: `src/utils/result.ts`
- Test: `tests/unit/bookmarks/contracts.test.ts`

**Interfaces:**
- Produces: `BookmarkNode`, `BookmarkRepository`, `BookmarkMetadata`, `MetadataRepository`, and `Result<T, E>`.

- [x] **Step 1: Write compile-time and runtime contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { isBookmark } from '../../../src/bookmarks/types';

describe('bookmark contracts', () => {
  it('distinguishes bookmarks from folders by URL presence', () => {
    expect(isBookmark({ id: '1', parentId: '0', index: 0, title: 'A', url: 'https://a.test' })).toBe(true);
    expect(isBookmark({ id: '2', parentId: '0', index: 1, title: 'Folder' })).toBe(false);
  });
});
```

- [x] **Step 2: Implement the contracts exactly as locked in the master plan**

Add these repository methods:

```ts
export interface MetadataRepository {
  get(bookmarkId: BookmarkId): Promise<BookmarkMetadata | null>;
  put(metadata: BookmarkMetadata): Promise<void>;
  softDelete(bookmarkId: BookmarkId, deletedAt: number): Promise<void>;
  restore(bookmarkId: BookmarkId): Promise<void>;
  purgeDeletedBefore(timestamp: number): Promise<number>;
}
```

Use discriminated `Result<T, E>` values instead of throwing for expected validation failures.

- [x] **Step 3: Verify contracts**

Run: `pnpm test -- tests/unit/bookmarks/contracts.test.ts && pnpm typecheck`  
Expected: PASS and no TypeScript errors.

- [x] **Step 4: Commit**

```bash
git add src/bookmarks src/storage/types.ts src/utils/result.ts tests/unit/bookmarks
git commit -m "feat: 定义书签领域接口"
```

### Task 3: Create the versioned IndexedDB schema and metadata repository

**Files:**
- Create: `src/storage/database.ts`
- Create: `src/storage/schema.ts`
- Create: `src/storage/metadata-repository.ts`
- Create: `src/storage/migrations.ts`
- Test: `tests/unit/storage/metadata-repository.test.ts`
- Test: `tests/unit/storage/migrations.test.ts`

**Interfaces:**
- Consumes: `BookmarkMetadata`, `MetadataRepository`.
- Produces: `SiftmarkDatabase`, `DexieMetadataRepository`, `openSiftmarkDatabase(name?: string)`.

- [x] **Step 1: Write failing repository tests with fake IndexedDB**

```ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openSiftmarkDatabase } from '../../../src/storage/database';
import { DexieMetadataRepository } from '../../../src/storage/metadata-repository';

describe('DexieMetadataRepository', () => {
  afterEach(async () => Dexie.delete('siftmark-test'));

  it('soft deletes and restores metadata without losing fields', async () => {
    const db = openSiftmarkDatabase('siftmark-test');
    const repo = new DexieMetadataRepository(db);
    await repo.put({ bookmarkId: 'b1', summary: '摘要', tags: ['AI'], note: '', confidence: 'high', reason: '规则', health: 'unchecked', updatedAt: 1 });
    await repo.softDelete('b1', 2);
    expect(await repo.get('b1')).toBeNull();
    await repo.restore('b1');
    expect((await repo.get('b1'))?.summary).toBe('摘要');
  });
});
```

- [x] **Step 2: Define database version 1**

Create tables with these primary/index keys:

```ts
this.version(1).stores({
  bookmarkMetadata: '&bookmarkId, updatedAt, confidence, health',
  thumbnails: '&bookmarkId, hash, createdAt, lastAccessedAt',
  operationLog: '&id, batchId, idempotencyKey, createdAt',
  tasks: '&id, type, state, updatedAt, idempotencyKey',
  searchIndex: '&bookmarkId, embeddingProfile, vectorVersion',
  notifications: '&id, read, type, createdAt',
  aiUsageLog: '&requestId, profileId, taskType, status, createdAt',
  softDeletedMetadata: '&bookmarkId, deletedAt',
  visitAggregates: '&bookmarkId, lastVisitedAt'
});
```

- [x] **Step 3: Implement metadata operations and migration runner**

Use a single Dexie transaction for moving rows between `bookmarkMetadata` and `softDeletedMetadata`. `purgeDeletedBefore` must return the deleted row count.

- [x] **Step 4: Verify persistence**

Run: `pnpm test -- tests/unit/storage && pnpm typecheck`  
Expected: soft delete, restore, purge, and reopen tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/storage tests/unit/storage
git commit -m "feat: 建立版本化本地数据库"
```

### Task 4: Implement the Chrome bookmarks adapter and event gateway

**Files:**
- Create: `src/platform/chrome/bookmarks-adapter.ts`
- Create: `src/platform/chrome/bookmark-events.ts`
- Create: `src/platform/chrome/chrome-types.ts`
- Test: `tests/unit/platform/chrome-bookmarks-adapter.test.ts`
- Test: `tests/integration/bookmark-event-sync.test.ts`

**Interfaces:**
- Consumes: `BookmarkRepository`, `BookmarkNode`, `MetadataRepository`.
- Produces: `ChromeBookmarkRepository`, `registerBookmarkEventSync(deps): () => void`.

- [x] **Step 1: Write adapter tests against a deterministic Chrome fake**

```ts
it('maps a Chrome folder without inventing a URL', async () => {
  chromeFake.bookmarks.get.mockResolvedValue([{ id: '10', parentId: '1', index: 0, title: '技术' }]);
  const node = await repository.get('10');
  expect(node).toEqual({ id: '10', parentId: '1', index: 0, title: '技术', dateAdded: undefined });
});
```

Cover create, update, move, remove, missing IDs, `runtime.lastError`, and event unsubscription.

- [x] **Step 2: Implement Chrome-to-domain mapping**

All callback and Promise Chrome API variants must normalize through one `callChrome` helper. Never expose `chrome.bookmarks.BookmarkTreeNode` outside the adapter.

- [x] **Step 3: Implement incremental metadata synchronization**

`onRemoved` calls `metadata.softDelete(id, Date.now())`. `onCreated` and `onChanged` queue index refresh events. Import begin/end events suppress per-item AI scheduling but still preserve eventual consistency.

- [x] **Step 4: Verify**

Run: `pnpm test -- tests/unit/platform tests/integration/bookmark-event-sync.test.ts`  
Expected: all adapter and event lifecycle tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/platform tests/unit/platform tests/integration/bookmark-event-sync.test.ts
git commit -m "feat: 接入原生书签事件"
```

### Task 5: Add reversible operation journaling

**Files:**
- Create: `src/operations/types.ts`
- Create: `src/operations/operation-repository.ts`
- Create: `src/operations/bookmark-command-service.ts`
- Create: `src/operations/undo-service.ts`
- Test: `tests/unit/operations/bookmark-command-service.test.ts`
- Test: `tests/integration/operations-undo.test.ts`

**Interfaces:**
- Consumes: `BookmarkRepository`, `SiftmarkDatabase`.
- Produces: `BookmarkCommandService.move`, `BookmarkCommandService.rename`, `UndoService.undo`, `OperationRecord`.

- [x] **Step 1: Write the failing move/undo test**

```ts
it('restores the original parent and index', async () => {
  const operation = await commands.move({ bookmarkId: 'b1', parentId: 'new', index: 2, batchId: 'batch-1' });
  await undo.undo(operation.id);
  expect(bookmarks.move).toHaveBeenLastCalledWith('b1', 'old', 4);
});
```

- [x] **Step 2: Define operation records**

```ts
export interface OperationRecord {
  id: string;
  type: 'move' | 'rename' | 'remove' | 'restore' | 'metadata';
  bookmarkId: BookmarkId;
  batchId?: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: number;
  undoneAt?: number;
}
```

- [x] **Step 3: Implement command and undo transactions**

Read the current native node immediately before mutation. If it differs from the caller's expected snapshot, return a typed conflict and do not mutate. Persist the operation only after Chrome confirms success.

- [x] **Step 4: Verify**

Run: `pnpm test -- tests/unit/operations tests/integration/operations-undo.test.ts`  
Expected: rename/move/metadata undo and conflict tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/operations tests/unit/operations tests/integration/operations-undo.test.ts
git commit -m "feat: 实现可撤销书签操作"
```

### Task 6: Add the durable task repository and background recovery

**Files:**
- Create: `src/tasks/types.ts`
- Create: `src/tasks/task-repository.ts`
- Create: `src/tasks/task-runner.ts`
- Create: `src/tasks/task-recovery.ts`
- Modify: `entrypoints/background.ts`
- Test: `tests/unit/tasks/task-runner.test.ts`
- Test: `tests/integration/task-recovery.test.ts`

**Interfaces:**
- Produces: `TaskRepository`, `TaskRunner.register(type, handler)`, `TaskRunner.runNext()`, `recoverInterruptedTasks(now)`.

- [x] **Step 1: Write failing recovery tests**

```ts
it('marks an interrupted non-idempotent request as unknown', async () => {
  await tasks.put(task({ state: 'running', type: 'ai-request', updatedAt: 1 }));
  await recoverInterruptedTasks(tasks, 10_000);
  expect((await tasks.get('task-1'))?.state).toBe('unknown');
});
```

Also test that idempotent local tasks return to `queued`, cancelled tasks do not resume, and profile versions remain locked.

- [x] **Step 2: Implement atomic task claiming**

Use a Dexie transaction to change one `queued` task to `running`. A handler receives an `AbortSignal`, reports progress, and returns a terminal result. Only one runner may claim a task ID.

- [x] **Step 3: Register background lifecycle hooks**

On Service Worker startup, call recovery then process the next task. Use `chrome.alarms` for scheduled wakeups; do not use long-lived timers as the persistence mechanism.

- [x] **Step 4: Verify recovery**

Run: `pnpm test -- tests/unit/tasks tests/integration/task-recovery.test.ts && pnpm build`  
Expected: task state-machine tests PASS and the production build succeeds.

- [x] **Step 5: Commit and pass Gate 1**

```bash
git add src/tasks entrypoints/background.ts tests/unit/tasks tests/integration/task-recovery.test.ts
git commit -m "feat: 实现持久化任务恢复"
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all commands exit 0. Update Gate 1 in the master plan and commit `docs: 记录基础阶段验收结果`.
