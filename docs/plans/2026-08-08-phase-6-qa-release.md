# Phase 6 QA and Release Implementation Plan

> **For agentic workers:** Execute tasks in order without Superpowers skills. Release only after every automated and manual gate has evidence committed to the repository.

**Goal:** Prove the complete extension in real Chromium, verify performance and visual/accessibility constraints, finish documentation, and produce a checksum-recorded developer-mode ZIP.

**Architecture:** Playwright launches persistent Chromium contexts with the built extension. Deterministic fixtures replace live model providers and external pages; separate manual checklists cover Chrome and Edge behavior that cannot be reliably automated.

**Tech Stack:** Playwright, Chromium extension fixtures, axe-core, Vitest coverage, PowerShell packaging verification.

## Global Constraints

- No live API keys or billable provider calls in CI.
- No Web Store submission in this phase.
- Chrome and Edge manual evidence is required.
- Release artifact is a Chromium developer-mode ZIP plus SHA-256.
- Chinese Conventional Commits.

---

### Task 1: Create the real-extension Playwright harness

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/fixtures/extension.ts`
- Create: `tests/e2e/fixtures/chrome-state.ts`
- Create: `tests/e2e/fixtures/provider-server.ts`
- Create: `tests/e2e/helpers/extension-pages.ts`
- Create: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `test`, `expect`, `extensionId`, `openExtensionPage`, local provider fixture.

- [x] **Step 1: Build before E2E**

Configure Playwright `webServer` to start a deterministic local content/provider fixture and require `pnpm build` before launch. Use a persistent Chromium context with `--disable-extensions-except` and `--load-extension` pointing to `.output/chrome-mv3`.

- [x] **Step 2: Write the extension smoke test**

```ts
test('loads popup, manager, options, and background worker', async ({ context, extensionId }) => {
  await expect(await context.newPage()).toBeTruthy();
  for (const path of ['popup.html', 'manager.html', 'options.html']) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await expect(page.getByText('Siftmark')).toBeVisible();
  }
});
```

Resolve actual WXT output page paths from the built manifest rather than hard-coding if WXT emits entrypoint subpaths.

- [x] **Step 3: Verify and commit**

Run: `pnpm build && pnpm test:e2e -- tests/e2e/smoke.spec.ts`  
Expected: real extension pages and Service Worker load without console errors.

```bash
git add playwright.config.ts tests/e2e
git commit -m "test: 建立真实扩展验收环境"
```

### Task 2: Cover critical end-to-end workflows

**Files:**
- Create: `tests/e2e/save-and-review.spec.ts`
- Create: `tests/e2e/bulk-and-undo.spec.ts`
- Create: `tests/e2e/model-profile.spec.ts`
- Create: `tests/e2e/search-and-health.spec.ts`
- Create: `tests/e2e/backup-roundtrip.spec.ts`
- Create: `tests/e2e/onboarding-and-reset.spec.ts`

**Interfaces:**
- Consumes: Phase 1–5 public UI and service behavior.

- [x] **Step 1: Test save and review**

Use a local article fixture. Save through Popup, assert native bookmark creation precedes AI response, capture a thumbnail, receive a fixture proposal, partially apply fields, and undo.

- [x] **Step 2: Test bulk and recovery**

Create 25 fixture bookmarks, assert secondary confirmation, simulate one provider failure and one Service Worker restart, then verify success/failure counts, resume, and batch undo.

- [x] **Step 3: Test profiles and security**

Verify draft/connection/activation, four protocol request shapes through the local fixture server, masked API keys, redacted logs, invalid Schema review, and no raw page body in IndexedDB.

- [x] **Step 4: Test search, health, and backup**

Verify Chinese keyword ranking, embedding fallback/version switch, duplicate review, link states, ZIP round trip, encrypted key archive wrong-password failure, MarkAI import preview, and conflict defaults.

- [x] **Step 5: Test onboarding and reset**

Verify skip/resume, optional model, special folders, read-only scan, notification opt-in, tiered counts, confirmation phrase, and preservation of native bookmarks.

- [x] **Step 6: Verify and commit**

Run: `pnpm test:e2e`  
Expected: all critical workflow specs PASS without external network access.

```bash
git add tests/e2e
git commit -m "test: 覆盖 Siftmark 核心端到端流程"
```

### Task 3: Add accessibility, responsive, animation, and visual checks

**Files:**
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/responsive.spec.ts`
- Create: `tests/e2e/themes.spec.ts`
- Create: `tests/e2e/lottie.spec.ts`
- Create: `tests/e2e/visual-overlap.spec.ts`
- Create: `tests/visual/.gitkeep`

**Interfaces:**
- Produces: screenshots and machine-readable accessibility/overlap results.

- [ ] **Step 1: Add axe accessibility checks**

Install `@axe-core/playwright`. Scan popup, manager, options, onboarding, review, import preview, and reset confirmation. Fail on serious/critical violations. Add explicit keyboard focus-order assertions.

- [ ] **Step 2: Add responsive/theme matrix**

Capture manager at 1440×900, 1280×720, 1024×768, and 800×700 in light/dark and comfortable/compact combinations. Assert the expected three-column/collapsed/drawer mode.

- [ ] **Step 3: Add overlap and text-fit checks**

For every visible interactive element, compare bounding boxes to its parent and adjacent controls. Fail for clipped labels, zero-size controls, unintended horizontal page scroll, or incoherent overlaps.

- [ ] **Step 4: Validate Lottie pixels and reduced motion**

Wait for two animation frames, compare screenshot pixel deltas in the animation region, assert nonblank bounds, then emulate reduced motion and assert the static asset remains stable.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test:e2e -- tests/e2e/accessibility.spec.ts tests/e2e/responsive.spec.ts tests/e2e/themes.spec.ts tests/e2e/lottie.spec.ts tests/e2e/visual-overlap.spec.ts`  
Expected: accessibility, layout, pixel movement, and static fallback checks PASS.

```bash
git add package.json pnpm-lock.yaml tests/e2e tests/visual
git commit -m "test: 加入无障碍与视觉回归门禁"
```

### Task 4: Prove large-library and durable-task performance

**Files:**
- Create: `tests/performance/bookmark-fixture.ts`
- Create: `tests/e2e/performance-10000.spec.ts`
- Create: `tests/e2e/task-recovery-load.spec.ts`
- Create: `docs/testing/performance-baseline.md`

**Interfaces:**
- Produces: reproducible 10,000-bookmark dataset and recorded baseline.

- [ ] **Step 1: Generate deterministic data**

Create 200 folders and 10,000 bookmarks from a seeded generator. Include Chinese/Latin titles, duplicates, health states, tags, notes, and metadata but no external URLs requiring network.

- [ ] **Step 2: Measure virtualized manager behavior**

Assert the initial rendered bookmark row count remains bounded, scrolling reaches the last item, selection does not shift layout, search returns results, and no long task blocks Popup save.

- [ ] **Step 3: Measure task recovery**

Queue 1,000 local tasks, interrupt the Service Worker, resume, and assert no duplicate idempotency keys or lost terminal states.

- [ ] **Step 4: Record the baseline**

Write machine, browser, dataset seed, timings, memory observations, and pass/fail thresholds to `performance-baseline.md`. Do not claim universal performance beyond the measured environment.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test:e2e -- tests/e2e/performance-10000.spec.ts tests/e2e/task-recovery-load.spec.ts`  
Expected: bounded DOM, successful navigation/search, and exactly-once local effects PASS.

```bash
git add tests/performance tests/e2e/performance-10000.spec.ts tests/e2e/task-recovery-load.spec.ts docs/testing/performance-baseline.md
git commit -m "test: 验证万级书签与任务恢复性能"
```

### Task 5: Complete user, developer, privacy, and test documentation

**Files:**
- Create: `README.md`
- Create: `docs/user-guide.md`
- Create: `docs/development.md`
- Create: `docs/architecture.md`
- Create: `docs/model-protocols.md`
- Create: `docs/backup-and-restore.md`
- Create: `docs/privacy-and-permissions.md`
- Create: `docs/testing/manual-chrome.md`
- Create: `docs/testing/manual-edge.md`
- Create: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: complete local installation, operation, troubleshooting, and compliance documentation.

- [ ] **Step 1: Write installation and user workflows**

Document Node/pnpm prerequisites, install/build/load-unpacked steps, first-run choices, model profile setup, save/review/search/archive/recycle, backup/import, and reset.

- [ ] **Step 2: Document architecture and protocols**

Explain domain ports, storage ownership, task recovery, adapter request shapes, fixture testing, security boundaries, and how to add a preset without adding a new protocol.

- [ ] **Step 3: Document privacy and permissions**

List each required/optional permission, `<all_urls>` rationale before install, local plaintext API-key boundary, provider data flow, no telemetry, incognito behavior, body-text disposal, screenshot policy, and notification privacy.

- [ ] **Step 4: Write exact manual checklists**

Chrome and Edge checklists must include install, permissions, bookmark events, incognito opt-in, Service Worker restart, context menus, shortcuts, notifications, fonts, Lottie, ZIP import/export, and uninstall/reinstall backup recovery.

- [ ] **Step 5: Verify and commit**

Run: `Get-ChildItem README.md,THIRD_PARTY_NOTICES.md,docs -Recurse -File | Measure-Object -Property Length -Sum`  
Expected: all required documentation files exist and have nonzero size; run all documentation commands from a clean clone.

```bash
git add README.md docs THIRD_PARTY_NOTICES.md
git commit -m "docs: 完善使用开发与隐私文档"
```

### Task 6: Run final gates and produce the Chromium ZIP

**Files:**
- Create: `scripts/package-release.ps1`
- Create: `dist/.gitkeep`
- Create: `docs/releases/0.1.0.md`
- Modify: `package.json`
- Modify: `docs/plans/2026-08-08-siftmark-master-plan.md`

**Interfaces:**
- Produces: `dist/siftmark-0.1.0-chromium.zip`, `.sha256`, and release record.

- [ ] **Step 1: Add deterministic packaging script**

The PowerShell script must run quality gates, remove any previous exact version staging directory only after validating it is under `dist/`, call `pnpm zip`, copy the resulting Chromium ZIP to the exact release name, compute SHA-256, and write the checksum file.

Use this control flow in `scripts/package-release.ps1`:

```powershell
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = Join-Path $repoRoot 'dist'
$target = Join-Path $distRoot "siftmark-$Version-chromium.zip"
$startedAt = Get-Date

Push-Location $repoRoot
try {
  pnpm typecheck
  if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
  pnpm lint
  if ($LASTEXITCODE -ne 0) { throw 'lint failed' }
  pnpm test --coverage
  if ($LASTEXITCODE -ne 0) { throw 'unit tests failed' }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
  pnpm test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'e2e tests failed' }
  pnpm zip
  if ($LASTEXITCODE -ne 0) { throw 'zip failed' }

  New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
  $source = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.output') -Recurse -Filter '*.zip' -File |
    Where-Object { $_.LastWriteTime -ge $startedAt } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $source) { throw 'WXT did not produce a new zip' }

  Copy-Item -LiteralPath $source.FullName -Destination $target -Force
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$target.sha256" -Value "$hash  $(Split-Path $target -Leaf)" -Encoding ascii
} finally {
  Pop-Location
}
```

- [ ] **Step 2: Run the complete automated gate**

Run: `pnpm typecheck && pnpm lint && pnpm test --coverage && pnpm build && pnpm test:e2e`  
Expected: every command exits 0; coverage report and Playwright report are generated.

- [ ] **Step 3: Execute Chrome and Edge manual checklists**

Record browser versions, date, tester, result, and issue links in each checklist. Any failure blocks packaging.

- [ ] **Step 4: Package and validate**

Run: `powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1 -Version 0.1.0`  
Expected: ZIP and SHA-256 exist. Extract to a temporary directory, validate `manifest.json`, required entrypoints, local fonts/icons/Lottie, and absence of source maps containing credentials.

- [ ] **Step 5: Write release record**

Record Git commit, ZIP path, SHA-256, automated gate commands, Chrome/Edge versions, known non-blocking limitations, and rollback/import guidance in `docs/releases/0.1.0.md`.

- [ ] **Step 6: Commit and pass Gate 6**

```bash
git add scripts/package-release.ps1 dist/.gitkeep docs/releases/0.1.0.md package.json docs/plans/2026-08-08-siftmark-master-plan.md
git commit -m "chore: 打包 Siftmark Chromium 版本"
```

Expected: clean Git status, all six master gates checked, and the release artifact matches its checksum.
