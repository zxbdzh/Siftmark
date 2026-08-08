# Phase 3 Interface and Workflow Implementation Plan

> **For agentic workers:** Execute tasks in order without Superpowers skills. Every visible command must be wired to a real domain service or deliberately disabled with an accessible reason.

**Goal:** Deliver the responsive Siftmark manager, review workflows, Popup, settings, content entrypoint, shortcuts, and context menus with the approved visual system.

**Architecture:** React entrypoints consume typed application services through hooks. Zustand stores view state only; persistent domain state remains in repositories and is refreshed by domain events.

**Tech Stack:** React, Zustand, TanStack Virtual, Testing Library, Lucide, Lottie React, CSS custom properties.

## Global Constraints

- Simplified Chinese only.
- WCAG 2.2 AA target.
- Light/dark/system themes and comfortable/compact density.
- Brand black `#111111`; lime `#B7FF36` only for brand and AI activity.
- No nested decorative cards, remote assets, or fake buttons.

---

### Task 1: Build the design tokens, fonts, icons, and motion primitives

**Files:**
- Create: `src/ui/styles/tokens.css`
- Create: `src/ui/styles/base.css`
- Create: `src/ui/styles/fonts.css`
- Create: `src/ui/styles/density.css`
- Create: `src/ui/styles/motion.css`
- Create: `src/ui/theme/theme-store.ts`
- Create: `src/ui/components/AiStatusMark.tsx`
- Create: `assets/icons/siftmark.svg`
- Create: `assets/lottie/idle.json`
- Create: `assets/lottie/analyzing.json`
- Create: `assets/lottie/success.json`
- Create: `assets/lottie/paused.json`
- Test: `tests/unit/ui/theme-store.test.ts`
- Test: `tests/unit/ui/ai-status-mark.test.tsx`

**Interfaces:**
- Produces: `ThemePreference`, `DensityPreference`, `useThemeStore`, `AiStatusMark`.

- [x] **Step 1: Write theme and reduced-motion tests**

```ts
it('uses a static fallback when reduced motion is requested', () => {
  matchMediaMock.set('(prefers-reduced-motion: reduce)', true);
  render(<AiStatusMark state="analyzing" label="正在分析" />);
  expect(screen.getByRole('img', { name: '正在分析' })).toHaveAttribute('data-motion', 'static');
});
```

- [x] **Step 2: Define exact tokens**

```css
:root {
  --brand-ink: #111111;
  --brand-ai: #b7ff36;
  --surface-0: #ffffff;
  --surface-1: #f5f6f7;
  --text-1: #17191c;
  --text-2: #5d636b;
  --danger: #c9362b;
  --warning: #a76700;
  --focus: #1875d1;
  --radius-sm: 4px;
  --radius-md: 8px;
}
```

Define dark equivalents with AA contrast. Font sizes are 13–14px for body/controls and 18–28px for headings. Do not use viewport-scaled font sizes or negative letter spacing.

Import `@fontsource-variable/noto-sans-sc/wght.css` and `@fontsource-variable/space-grotesk/wght.css` from `fonts.css`; WXT must bundle their WOFF2 subsets locally. Record both OFL licenses in `THIRD_PARTY_NOTICES.md` during Phase 6.

- [x] **Step 3: Rebuild the selected concept as deterministic vector assets**

Use the funnel/bookmark geometry from palette C only as a concept reference. Create clean SVG paths for 16/48/128px and wordmark use. Do not embed the generated PNG in production UI.

- [x] **Step 4: Create four original local Lottie states**

Each JSON must use vector shapes only, loop only for idle/analyzing, and have a static SVG fallback. Validate JSON parsing and nonzero bounds in tests.

- [x] **Step 5: Verify and commit**

Run: `pnpm test -- tests/unit/ui/theme-store.test.ts tests/unit/ui/ai-status-mark.test.tsx && pnpm build`  
Expected: theme, reduced-motion, local asset, and build tests PASS.

```bash
git add src/ui assets tests/unit/ui
git commit -m "feat: 建立 Siftmark 视觉与动效系统"
```

### Task 2: Implement the three-column manager shell and virtual lists

**Files:**
- Create: `entrypoints/manager/index.html`
- Create: `entrypoints/manager/main.tsx`
- Create: `entrypoints/manager/App.tsx`
- Create: `src/ui/manager/manager-store.ts`
- Create: `src/ui/manager/ManagerLayout.tsx`
- Create: `src/ui/manager/FolderTree.tsx`
- Create: `src/ui/manager/BookmarkList.tsx`
- Create: `src/ui/manager/DetailPanel.tsx`
- Create: `src/ui/manager/ResponsiveDrawer.tsx`
- Test: `tests/unit/ui/manager-layout.test.tsx`
- Test: `tests/unit/ui/bookmark-list.test.tsx`

**Interfaces:**
- Consumes: `BookmarkRepository`, `MetadataRepository`.
- Produces: `useManagerStore`, `ManagerLayout`, virtualized folder/bookmark row renderers.

- [x] **Step 1: Write layout behavior tests**

Assert three labeled regions at wide width, collapsible detail at medium width, drawer buttons at narrow width, stable row height for each density, and no nested cards.

- [x] **Step 2: Define view-only manager state**

```ts
interface ManagerViewState {
  selectedFolderId: BookmarkId | null;
  selectedBookmarkIds: Set<BookmarkId>;
  detailBookmarkId: BookmarkId | null;
  density: 'comfortable' | 'compact';
  sort: { field: 'manual' | 'title' | 'domain' | 'createdAt' | 'updatedAt' | 'visitedAt' | 'health' | 'confidence'; direction: 'asc' | 'desc' };
}
```

- [x] **Step 3: Implement virtualized tree and list**

Use stable row keys and fixed density dimensions. Persist sort per folder in local settings. Hover, selection, loading labels, and icons must not change row dimensions.

- [x] **Step 4: Implement selection and responsive details**

Support click, Ctrl/Command multi-select, Shift range, keyboard arrows, Home/End, and Escape. Detail edits call services rather than mutating UI state as persistence.

- [x] **Step 5: Verify and commit**

Run: `pnpm test -- tests/unit/ui/manager-layout.test.tsx tests/unit/ui/bookmark-list.test.tsx`  
Expected: layout, virtualization, selection, and keyboard tests PASS.

```bash
git add entrypoints/manager src/ui/manager tests/unit/ui/manager-layout.test.tsx tests/unit/ui/bookmark-list.test.tsx
git commit -m "feat: 构建三栏书签管理器"
```

### Task 3: Add review queues, details, context actions, and drag/drop

**Files:**
- Create: `src/ui/review/ReviewWorkspace.tsx`
- Create: `src/ui/review/ReviewFilters.tsx`
- Create: `src/ui/review/ProposalEditor.tsx`
- Create: `src/ui/manager/BookmarkContextMenu.tsx`
- Create: `src/ui/manager/FolderContextMenu.tsx`
- Create: `src/ui/manager/use-bookmark-dnd.ts`
- Create: `src/ui/markdown/sanitize-markdown.ts`
- Create: `src/ui/manager/MarkdownNoteEditor.tsx`
- Create: `src/ai/proposal-repository.ts`
- Test: `tests/unit/ui/review-workspace.test.tsx`
- Test: `tests/integration/review-apply.test.ts`
- Test: `tests/unit/ui/markdown-note-editor.test.tsx`

**Interfaces:**
- Consumes: `AnalysisProposal`, `BookmarkCommandService`, `UndoService`.
- Produces: proposal query/update repository and review apply/reject commands.

- [x] **Step 1: Write proposal application tests**

```ts
it('applies only checked fields and retains the proposal audit record', async () => {
  await applyProposal({ proposalId: 'p1', fields: ['title', 'tags'] });
  expect(commands.rename).toHaveBeenCalledOnce();
  expect(commands.move).not.toHaveBeenCalled();
  expect(await proposals.get('p1')).toMatchObject({ state: 'approved' });
});
```

- [x] **Step 2: Build queue filters and field-level editor**

Expose pending, low confidence, conflict, failed, duplicate, and dead-link filters. Show confidence level and short reason, not chain-of-thought or a fabricated percentage.

The note editor supports Markdown text only. Escape raw HTML, block script/style/iframe/object nodes, do not auto-load remote images, and require an explicit click before opening links.

- [x] **Step 3: Implement context menus**

Bookmark commands: open, move, analyze, queue review, tag, export, copy link, recycle. Folder commands add child folder and health scan. Dangerous commands require clear confirmation.

- [x] **Step 4: Implement drag/drop with keyboard parity**

Drag previews must show destination. Drop calls `BookmarkCommandService.move` with the current snapshot. Provide a keyboard “移动到…” menu that invokes the same service.

- [x] **Step 5: Verify and commit**

Run: `pnpm test -- tests/unit/ui/review-workspace.test.tsx tests/integration/review-apply.test.ts`  
Expected: queue filters, partial apply, conflict, undo, DnD, and keyboard parity PASS.

```bash
git add src/ui/review src/ui/manager src/ai/proposal-repository.ts tests/unit/ui/review-workspace.test.tsx tests/integration/review-apply.test.ts
git commit -m "feat: 实现统一审核与批量操作"
```

### Task 4: Implement Popup quick save and progress

**Files:**
- Modify: `entrypoints/popup/App.tsx`
- Create: `src/ui/popup/use-current-tab.ts`
- Create: `src/ui/popup/QuickSave.tsx`
- Create: `src/ui/popup/TaskProgress.tsx`
- Create: `src/ui/popup/TabBatchSave.tsx`
- Create: `src/bookmarks/save-service.ts`
- Test: `tests/unit/ui/quick-save.test.tsx`
- Test: `tests/integration/quick-save-flow.test.ts`

**Interfaces:**
- Produces: `SaveService.saveCurrentTab`, `SaveService.saveTabs`, `SaveResult`, task progress subscription.

- [x] **Step 1: Write the nonblocking save test**

```ts
it('returns after native bookmark creation without waiting for AI', async () => {
  aiQueue.enqueue.mockImplementation(() => new Promise(() => undefined));
  await expect(saveService.saveCurrentTab(tab)).resolves.toMatchObject({ bookmarkId: 'b1', analysisQueued: true });
});
```

- [x] **Step 2: Implement duplicate preview and destination choice**

Show existing matches before create. Default to the last folder; allow rule/AI suggestion and manual folder selection. AI analysis and thumbnail tasks enqueue after native creation.

`saveTabs(tabIds)` supports selected tabs or every tab in the current window, filters unsupported schemes, presents a deduplicated preview, and creates native bookmarks before optionally queuing AI work.

- [x] **Step 3: Implement progress and undo**

Popup shows saved, analyzing, pending review, failed, and completed states. Undo calls the operation service and remains available after Popup reopen through operation history.

- [x] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/ui/quick-save.test.tsx tests/integration/quick-save-flow.test.ts && pnpm build`  
Expected: immediate save, duplicate handling, queued work, and undo tests PASS.

```bash
git add entrypoints/popup src/ui/popup src/bookmarks/save-service.ts tests/unit/ui/quick-save.test.tsx tests/integration/quick-save-flow.test.ts
git commit -m "feat: 完成 Popup 快速保存流程"
```

### Task 5: Build model, rule, privacy, and appearance settings

**Files:**
- Create: `entrypoints/options/index.html`
- Create: `entrypoints/options/main.tsx`
- Create: `entrypoints/options/App.tsx`
- Create: `src/ui/options/ModelProfilesSection.tsx`
- Create: `src/ui/options/RulesSection.tsx`
- Create: `src/ui/options/PermissionsSection.tsx`
- Create: `src/ui/options/AppearanceSection.tsx`
- Create: `src/ui/options/SpecialFoldersSection.tsx`
- Create: `src/ui/options/PromptRulesSection.tsx`
- Create: `src/ui/options/IncognitoSection.tsx`
- Create: `src/ui/options/AiUsageSection.tsx`
- Test: `tests/unit/ui/model-profiles-section.test.tsx`
- Test: `tests/unit/ui/rules-section.test.tsx`

**Interfaces:**
- Consumes: profile, rule, theme, permission, and special-folder services.

- [x] **Step 1: Write model profile activation tests**

Assert draft save, masked key display, minimal connection test, capability results, verified-only activation, and per-task profile assignment.

- [x] **Step 2: Implement settings sections**

Use forms with explicit labels, inline validation, save status, reset actions, and no silent autosave for API keys. Prompt customization exposes additional rules and a preview, never the protected schema/safety instructions.

- [x] **Step 3: Implement permissions and special folders**

Show granted/revoked state, notification opt-in, host permission consequences, and folder-ID health. Missing special folders pause their workflows and offer re-link/create actions.

The incognito section calls `chrome.extension.isAllowedIncognitoAccess`, explains that Chromium controls the permission externally, links to the extension details page, and states that authorized incognito records share ordinary storage without a source marker.

The AI usage section lists local request count, token totals, latency, status, model, and task type from `aiUsageLog`. It offers filtering and clearing but no budget, hard limit, or telemetry upload.

- [x] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/ui/model-profiles-section.test.tsx tests/unit/ui/rules-section.test.tsx`  
Expected: forms, accessibility, verification gates, and permission fallbacks PASS.

```bash
git add entrypoints/options src/ui/options tests/unit/ui/model-profiles-section.test.tsx tests/unit/ui/rules-section.test.tsx
git commit -m "feat: 构建模型与扩展设置中心"
```

### Task 6: Add content UI, browser commands, and context menus

**Files:**
- Modify: `entrypoints/content.ts`
- Modify: `entrypoints/background.ts`
- Create: `src/ui/content/FloatingButton.tsx`
- Create: `src/ui/content/ContentToast.tsx`
- Create: `src/platform/chrome/commands.ts`
- Create: `src/platform/chrome/context-menus.ts`
- Test: `tests/unit/ui/floating-button.test.tsx`
- Test: `tests/integration/browser-entrypoints.test.ts`

**Interfaces:**
- Produces: content message handlers, registered save command, registered context menu IDs.

- [x] **Step 1: Write entrypoint registration tests**

Assert one default save command, exact context menu IDs, no duplicate registration after Service Worker restart, and disabled floating button by default.

- [x] **Step 2: Implement isolated content UI**

Mount in a shadow root. Support drag position, minimize, domain hide, keyboard focus, and Toast feedback. Do not inject into browser internal pages.

- [x] **Step 3: Implement context menu data handling**

Page/link saves reuse `SaveService`. Selected text becomes a local Markdown draft capped at 2,000 characters and is never automatically sent to AI.

- [x] **Step 4: Verify and pass Gate 3**

Run: `pnpm typecheck && pnpm lint && pnpm test -- tests/unit/ui tests/integration/browser-entrypoints.test.ts && pnpm build`  
Expected: all UI and entrypoint tests PASS.

- [x] **Step 5: Commit**

```bash
git add entrypoints src/ui/content src/platform/chrome tests/unit/ui/floating-button.test.tsx tests/integration/browser-entrypoints.test.ts
git commit -m "feat: 加入网页入口与浏览器命令"
```

Update Gate 3 in the master plan and commit `docs: 记录界面阶段验收结果`.
