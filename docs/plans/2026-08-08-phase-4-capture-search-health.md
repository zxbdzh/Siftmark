# Phase 4 Capture, Search, and Health Implementation Plan

> **For agentic workers:** Execute tasks in order without Superpowers skills. Network tests use local fixtures and mocked fetch; scheduled jobs must remain opt-in.

**Goal:** Add privacy-aware page extraction and thumbnails, local and semantic search, duplicate and link-health scans, visit aggregates, and notifications.

**Architecture:** Capture produces ephemeral inputs and durable thumbnails; search indexes only approved metadata; health scanners emit review proposals rather than mutating bookmarks.

**Tech Stack:** Readability-style DOM extraction, Canvas/WebP, MiniSearch, IndexedDB vectors, Chrome tabs/alarms/notifications.

## Global Constraints

- Extracted body text is never persisted.
- Screenshots skip sensitive contexts and do not block save.
- Semantic search degrades to local search.
- Health and cleanup jobs never auto-delete.
- Chinese Conventional Commits.

---

### Task 1: Implement ephemeral page extraction and sensitive-page guards

**Files:**
- Create: `src/capture/types.ts`
- Create: `src/capture/page-policy.ts`
- Create: `src/capture/extract-page.ts`
- Create: `src/capture/truncate-content.ts`
- Modify: `entrypoints/content.ts`
- Test: `tests/unit/capture/page-policy.test.ts`
- Test: `tests/unit/capture/truncate-content.test.ts`
- Fixture: `tests/fixtures/pages/article.html`
- Fixture: `tests/fixtures/pages/login.html`

**Interfaces:**
- Produces: `PageCapture`, `evaluatePagePolicy`, `extractPageCapture`, `truncateByParagraph`.

- [ ] **Step 1: Write policy and truncation tests**

```ts
it('blocks capture when a password field is present', () => {
  document.body.innerHTML = '<input type="password">';
  expect(evaluatePagePolicy(document, location)).toMatchObject({ body: 'blocked', screenshot: 'blocked' });
});
```

Test login/payment patterns, browser/internal schemes, user blocklist, intranet detection, paragraph boundaries, title/description preference, and the 12,000-character ceiling.

- [ ] **Step 2: Implement extraction**

Return title, canonical URL, description, keywords, language, and truncated readable text. Remove scripts, styles, navigation, hidden nodes, form values, and contenteditable input. Keep the payload in the message response only; do not call storage APIs.

- [ ] **Step 3: Verify non-persistence**

Run: `pnpm test -- tests/unit/capture`  
Expected: extraction and blocking tests PASS; a test spy confirms no storage call.

- [ ] **Step 4: Commit**

```bash
git add src/capture entrypoints/content.ts tests/unit/capture tests/fixtures/pages
git commit -m "feat: 实现隐私受控网页采集"
```

### Task 2: Add visible-tab WebP thumbnails and storage cleanup

**Files:**
- Create: `src/capture/thumbnail-service.ts`
- Create: `src/storage/thumbnail-repository.ts`
- Create: `src/capture/image-processing.ts`
- Create: `src/tasks/handlers/capture-thumbnail.ts`
- Create: `src/ui/manager/ThumbnailPreview.tsx`
- Test: `tests/unit/capture/image-processing.test.ts`
- Test: `tests/integration/thumbnail-service.test.ts`
- Test: `tests/unit/ui/thumbnail-preview.test.tsx`

**Interfaces:**
- Produces: `ThumbnailService.captureCurrentTab`, `ThumbnailRepository`, `enforceThumbnailBudget`.

- [ ] **Step 1: Write image constraints tests**

Assert maximum edge 1280px, WebP quality 0.72, hash deduplication, metadata reference, failed-state fallback image, 200 MB budget, and least-recently-used eviction.

- [ ] **Step 2: Implement capture and conversion**

Call `chrome.tabs.captureVisibleTab` only after policy approval. Decode to an offscreen canvas, scale without upsampling, export WebP, and discard the source data URL after the Blob is committed.

- [ ] **Step 3: Implement failure behavior**

Permission, restricted page, tab switch, decode, and quota failures update thumbnail state but never roll back the native bookmark. Manual refresh enqueues the same handler.

The detail panel preview opens a local full-size modal first, shows capture time and refresh state, and exposes a separate explicit “打开网页” command.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/capture/image-processing.test.ts tests/integration/thumbnail-service.test.ts`  
Expected: dimension, format, LRU, failure, and manual refresh tests PASS.

```bash
git add src/capture src/storage/thumbnail-repository.ts src/tasks/handlers/capture-thumbnail.ts tests/unit/capture tests/integration/thumbnail-service.test.ts
git commit -m "feat: 加入本地网页缩略图"
```

### Task 3: Build local Chinese-aware search and filters

**Files:**
- Create: `src/search/types.ts`
- Create: `src/search/tokenize.ts`
- Create: `src/search/local-search-index.ts`
- Create: `src/search/search-service.ts`
- Create: `src/ui/search/SearchBar.tsx`
- Create: `src/ui/search/SearchFilters.tsx`
- Test: `tests/unit/search/tokenize.test.ts`
- Test: `tests/unit/search/search-service.test.ts`
- Test: `tests/unit/ui/search-bar.test.tsx`

**Interfaces:**
- Produces: `SearchQuery`, `SearchResult`, `LocalSearchIndex`, `SearchService.search`.

- [ ] **Step 1: Write ranking tests**

```ts
it('ranks an exact title before a fuzzy summary match', async () => {
  const results = await service.search({ text: '浏览器扩展', filters: {} });
  expect(results.map((item) => item.bookmarkId)).toEqual(['exact', 'summary']);
});
```

Cover Chinese bigrams, Latin normalization, domain matching, prefixes, limited edit distance, tag boosts, folder/status/time filters, and deterministic ties.

- [ ] **Step 2: Implement incremental indexing**

Index title, URL, folder, tags, summary, and note. Update only changed bookmark IDs after domain events. Rebuild in resumable chunks for first scan or schema migration.

- [ ] **Step 3: Wire search UI**

Use a debounced query, keyboard result navigation, filter controls, explicit “本地搜索” mode label, and stable list dimensions.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/search tests/unit/ui/search-bar.test.tsx`  
Expected: ranking, filters, incremental update, and accessible UI tests PASS.

```bash
git add src/search src/ui/search tests/unit/search tests/unit/ui/search-bar.test.tsx
git commit -m "feat: 实现本地混合检索"
```

### Task 4: Add versioned embedding indexes and fused ranking

**Files:**
- Create: `src/search/embedding/types.ts`
- Create: `src/search/embedding/embedding-repository.ts`
- Create: `src/search/embedding/embedding-indexer.ts`
- Create: `src/search/embedding/vector-search.ts`
- Create: `src/search/fuse-results.ts`
- Create: `src/tasks/handlers/index-embeddings.ts`
- Test: `tests/unit/search/vector-search.test.ts`
- Test: `tests/integration/embedding-reindex.test.ts`

**Interfaces:**
- Consumes: an enabled profile with `embed` capability.
- Produces: `EmbeddingVersion`, `EmbeddingIndexer.enqueueMissing`, `fuseSearchResults`.

- [ ] **Step 1: Write version isolation tests**

```ts
it('never compares vectors from different model versions', async () => {
  await repository.put(vector({ bookmarkId: 'a', profile: 'p1', version: 'v1', dimensions: 3 }));
  await repository.put(vector({ bookmarkId: 'b', profile: 'p1', version: 'v2', dimensions: 3 }));
  expect(await search.query([1, 0, 0], key('p1', 'v1', 3))).toHaveLength(1);
});
```

- [ ] **Step 2: Implement privacy-limited input**

Build embedding text from title, domain, folder path, tags, and AI summary only. Strip URL query/fragment and exclude note/body text.

- [ ] **Step 3: Implement resumable reindex and fusion**

New model versions mark old vectors stale and queue chunked rebuilds. Until complete, use local results plus only same-version vectors. Fuse normalized keyword and cosine scores with deterministic weights.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/search/vector-search.test.ts tests/integration/embedding-reindex.test.ts`  
Expected: privacy input, dimensions, version isolation, pause/resume, and fallback PASS.

```bash
git add src/search src/tasks/handlers/index-embeddings.ts tests/unit/search tests/integration/embedding-reindex.test.ts
git commit -m "feat: 加入可选语义检索"
```

### Task 5: Implement conservative duplicate and link-health scans

**Files:**
- Create: `src/health/url-normalization.ts`
- Create: `src/health/duplicate-detector.ts`
- Create: `src/health/link-checker.ts`
- Create: `src/health/health-scan-service.ts`
- Create: `src/tasks/handlers/scan-health.ts`
- Test: `tests/unit/health/url-normalization.test.ts`
- Test: `tests/unit/health/duplicate-detector.test.ts`
- Test: `tests/unit/health/link-checker.test.ts`

**Interfaces:**
- Produces: `normalizeUrlConservatively`, `DuplicateGroup`, `LinkHealth`, health review proposals.

- [ ] **Step 1: Write URL normalization tests**

Preserve business query parameters, remove known tracking parameters, normalize host/protocol case and default ports, preserve path case, and treat redirects as evidence rather than identity.

- [ ] **Step 2: Implement duplicate grouping**

Create exact normalized URL groups first, then separate similarity suggestions using title/domain evidence. Never delete or merge automatically. The review proposal defaults to retaining the earliest bookmark and merging metadata.

- [ ] **Step 3: Implement staged health requests**

Attempt a lightweight request, retry/transparently downgrade to GET when required, and classify `healthy`, `temporary`, `dead`, `restricted`, or `blocked`. Respect per-domain concurrency and cancellation.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/health`  
Expected: normalization, duplicate groups, status classes, retry, and cancellation PASS.

```bash
git add src/health src/tasks/handlers/scan-health.ts tests/unit/health
git commit -m "feat: 实现重复与失效链接检测"
```

### Task 6: Add visit aggregates, scheduling, and notification retention

**Files:**
- Create: `src/health/visit-aggregator.ts`
- Create: `src/notifications/types.ts`
- Create: `src/notifications/notification-repository.ts`
- Create: `src/notifications/notification-service.ts`
- Create: `src/platform/chrome/scheduler.ts`
- Create: `src/platform/chrome/browser-notifications.ts`
- Create: `src/ui/notifications/NotificationCenter.tsx`
- Create: `src/ui/manager/UsageInsights.tsx`
- Modify: `entrypoints/background.ts`
- Test: `tests/unit/health/visit-aggregator.test.ts`
- Test: `tests/unit/notifications/retention.test.ts`
- Test: `tests/integration/scheduled-health-scan.test.ts`

**Interfaces:**
- Produces: 90-day aggregates, opt-in schedules, local notifications, summary-only browser notifications.

- [ ] **Step 1: Write retention tests**

Assert visit events collapse into daily buckets, detailed URLs are not stored, buckets older than 90 days expire, notifications expire after 30 days or 500 rows, and oldest read rows are removed first.

- [ ] **Step 2: Implement opt-in scheduling**

Support weekly/monthly alarms scoped to selected folders. Installation must not create a recurring health alarm until the user enables it.

- [ ] **Step 3: Implement notification privacy**

Browser notifications contain counts and task state only. Titles, URLs, provider errors, and API details remain in the application center. Request optional notification permission only when enabling browser notifications.

Usage insights show local aggregate counts, last visit, 90-day trends, frequent domains, and cleanup suggestions. They never display or persist a per-visit URL timeline.

- [ ] **Step 4: Verify and pass Gate 4**

Run: `pnpm typecheck && pnpm lint && pnpm test -- tests/unit/capture tests/unit/search tests/unit/health tests/unit/notifications tests/integration/thumbnail-service.test.ts tests/integration/embedding-reindex.test.ts tests/integration/scheduled-health-scan.test.ts && pnpm build`  
Expected: all capture/search/health/notification tests and build PASS.

- [ ] **Step 5: Commit**

```bash
git add src/health src/notifications src/platform/chrome entrypoints/background.ts src/ui/notifications tests
git commit -m "feat: 完成统计调度与通知中心"
```

Update Gate 4 in the master plan and commit `docs: 记录增强能力阶段验收结果`.
