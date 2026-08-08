# Phase 5 Backup, Migration, and Onboarding Implementation Plan

> **For agentic workers:** Execute tasks in order without Superpowers skills. Importers parse into an isolated preview model before any Chrome bookmark mutation.

**Goal:** Deliver versioned backup/restore, encrypted key archives, HTML and MarkAI migration, conflict review, recycle/archive workflows, onboarding, and safe reset.

**Architecture:** Format parsers produce one neutral import graph. Validation and conflict resolution operate on the graph; only an explicit apply command writes through bookmark and metadata services.

**Tech Stack:** Zod, JSZip, Web Crypto, DOMParser, Vitest fixtures, React onboarding UI.

## Global Constraints

- Unknown native backup versions never write data.
- Plain exports redact API keys.
- Import never deletes existing bookmarks by default.
- Reset never deletes native bookmarks by default.
- Chinese Conventional Commits.

---

### Task 1: Define the native backup manifest and neutral import graph

**Files:**
- Create: `src/backup/types.ts`
- Create: `src/backup/schemas.ts`
- Create: `src/backup/import-graph.ts`
- Create: `src/backup/checksum.ts`
- Test: `tests/unit/backup/schemas.test.ts`
- Test: `tests/unit/backup/checksum.test.ts`

**Interfaces:**
- Produces: `BackupManifestV1`, `ImportGraph`, `ImportNode`, `sha256Hex`, `validateBackupManifest`.

- [x] **Step 1: Define exact version 1 structures**

```ts
export interface BackupManifestV1 {
  format: 'siftmark-backup';
  version: 1;
  exportedAt: string;
  appVersion: string;
  counts: { folders: number; bookmarks: number; metadata: number; thumbnails: number };
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

export interface ImportNode {
  sourceId: string;
  kind: 'folder' | 'bookmark';
  parentSourceId: string | null;
  title: string;
  url?: string;
  index: number;
  metadata?: Partial<BookmarkMetadata>;
}
```

- [x] **Step 2: Write validation tests**

Cover valid v1, unknown version, duplicate paths, path traversal, count mismatch, SHA-256 mismatch, missing data file, invalid URLs, and cyclic parents.

- [x] **Step 3: Implement deterministic checksums**

Hash exact file bytes with `crypto.subtle.digest('SHA-256', bytes)`. Do not hash parsed/re-serialized JSON when verifying imported files.

- [x] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/backup/schemas.test.ts tests/unit/backup/checksum.test.ts`  
Expected: all manifest and integrity tests PASS.

```bash
git add src/backup/types.ts src/backup/schemas.ts src/backup/import-graph.ts src/backup/checksum.ts tests/unit/backup
git commit -m "feat: 定义版本化备份格式"
```

### Task 2: Implement Siftmark JSON/ZIP export and import

**Files:**
- Create: `src/backup/native-exporter.ts`
- Create: `src/backup/native-importer.ts`
- Create: `src/backup/zip-container.ts`
- Create: `src/ui/backup/BackupCenter.tsx`
- Create: `src/ui/backup/ExportDialog.tsx`
- Test: `tests/unit/backup/native-roundtrip.test.ts`
- Fixture: `tests/fixtures/backup/siftmark-v1.json`

**Interfaces:**
- Produces: `exportNativeBackup`, `parseNativeBackup`, JSON and ZIP outputs.

- [x] **Step 1: Write round-trip tests**

Create a fixture with nested folders, tags, Chinese summary, Markdown note, operation history, and two thumbnails. Assert export/import equality excluding generated timestamps and source IDs.

- [x] **Step 2: Implement selected-scope export**

Export only selected roots and descendants. Include metadata and operation history. Exclude thumbnails by default; when selected, write WebP files under `thumbnails/` and include byte estimates before generation.

- [x] **Step 3: Implement ZIP parsing without publication**

Reject absolute paths, `..`, duplicate names, unsupported compression errors, and checksum mismatches. Return an `ImportGraph`; do not call Chrome APIs.

The backup center exposes selected-scope JSON/ZIP export, optional thumbnails with estimated size, native backup import, and a separate encrypted complete-configuration action. Every generated Blob is downloaded only after validation succeeds.

- [x] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/backup/native-roundtrip.test.ts`  
Expected: JSON and ZIP round trips, checksum failures, and thumbnail options PASS.

```bash
git add src/backup/native-exporter.ts src/backup/native-importer.ts src/backup/zip-container.ts tests/unit/backup/native-roundtrip.test.ts tests/fixtures/backup
git commit -m "feat: 实现 Siftmark 原生备份"
```

### Task 3: Add browser HTML, CSV, and MarkAI format support

**Files:**
- Create: `src/backup/netscape-html-importer.ts`
- Create: `src/backup/netscape-html-exporter.ts`
- Create: `src/backup/csv-exporter.ts`
- Create: `src/backup/markai-importer.ts`
- Test: `tests/unit/backup/netscape-html.test.ts`
- Test: `tests/unit/backup/markai-importer.test.ts`
- Test: `tests/unit/backup/csv-exporter.test.ts`
- Fixture: `tests/fixtures/backup/chrome-bookmarks.html`
- Fixture: `tests/fixtures/backup/markai-backup.json`

**Interfaces:**
- Produces: format-specific parsers/exporters returning `ImportGraph` or Blob.

- [x] **Step 1: Write fixture tests**

Cover nested DL/DT/H3/A structures, escaped titles, icon attributes ignored, malformed partial HTML, CSV formula injection, MarkAI settings/history/domain blacklist, and absent keys.

- [x] **Step 2: Implement safe browser HTML support**

Parse with `DOMParser`, accept local user-selected files only, and normalize root aliases without executing scripts. Export valid Netscape bookmark HTML with escaped text.

- [x] **Step 3: Implement CSV safety**

Prefix spreadsheet-formula-leading cells (`=`, `+`, `-`, `@`) with a single quote and quote all fields containing commas, quotes, or newlines.

- [x] **Step 4: Implement MarkAI migration**

Map bookmarks, compatible history, settings, and blocked domains. API keys remain omitted unless a separately supported encrypted Siftmark archive supplies them. Unknown MarkAI fields are reported but ignored.

- [x] **Step 5: Verify and commit**

Run: `pnpm test -- tests/unit/backup/netscape-html.test.ts tests/unit/backup/markai-importer.test.ts tests/unit/backup/csv-exporter.test.ts`  
Expected: fixtures and malicious-input tests PASS.

```bash
git add src/backup tests/unit/backup tests/fixtures/backup
git commit -m "feat: 支持书签与 MarkAI 数据迁移"
```

### Task 4: Implement encrypted complete configuration archives

**Files:**
- Create: `src/backup/encryption.ts`
- Create: `src/backup/encrypted-container.ts`
- Create: `src/backup/config-exporter.ts`
- Test: `tests/unit/backup/encryption.test.ts`
- Test: `tests/unit/backup/config-exporter.test.ts`

**Interfaces:**
- Produces: `encryptBackup`, `decryptBackup`, `.siftmark-backup` header, redacted/plain configuration export.

- [x] **Step 1: Define the encrypted header**

```ts
export interface EncryptedBackupHeader {
  magic: 'SIFTMARK';
  version: 1;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: 600000;
  salt: string;
  nonce: string;
}
```

- [x] **Step 2: Write cryptographic behavior tests**

Assert random salt/nonce per export, correct-password round trip, wrong-password failure without partial plaintext, ciphertext tamper failure, UTF-8 password handling, and absence of API key text in output bytes.

- [x] **Step 3: Implement Web Crypto flow**

Derive a 256-bit key with PBKDF2-SHA-256 and encrypt the complete ZIP bytes with AES-GCM. Authenticate the serialized header as additional data. Zero mutable plaintext/key byte arrays after use where JavaScript permits.

- [x] **Step 4: Implement redacted config export**

Plain JSON includes profile ID, name, protocol, endpoint, model, timeout, capabilities, and `hasApiKey`, but never the key value. Complete export is available only through encrypted container UI.

- [x] **Step 5: Verify and commit**

Run: `pnpm test -- tests/unit/backup/encryption.test.ts tests/unit/backup/config-exporter.test.ts`  
Expected: cryptography, tamper, and redaction tests PASS.

```bash
git add src/backup/encryption.ts src/backup/encrypted-container.ts src/backup/config-exporter.ts tests/unit/backup/encryption.test.ts tests/unit/backup/config-exporter.test.ts
git commit -m "feat: 加入加密模型配置备份"
```

### Task 5: Build conflict preview and transactional import application

**Files:**
- Create: `src/backup/conflict-detector.ts`
- Create: `src/backup/import-plan.ts`
- Create: `src/backup/import-application-service.ts`
- Create: `src/ui/backup/ImportPreview.tsx`
- Create: `src/ui/backup/ConflictResolver.tsx`
- Test: `tests/unit/backup/conflict-detector.test.ts`
- Test: `tests/integration/backup-import-apply.test.ts`
- Test: `tests/unit/ui/import-preview.test.tsx`

**Interfaces:**
- Produces: `ImportConflict`, `ImportDecision`, `ImportPlan`, `applyImportPlan`.

- [x] **Step 1: Write conflict tests**

Detect exact URL, normalized URL, title/folder, duplicate source node, and metadata-only conflicts. Default every conflict to `keep-existing`; never default to overwrite/delete.

- [x] **Step 2: Implement preview UI**

Display format, version, counts, integrity, key presence, thumbnail size, unknown fields, and conflicts. Allow skip, keep existing, create duplicate, or merge tags/note.

- [x] **Step 3: Implement resumable application**

Create a backup recovery point first. Apply the approved plan through `BookmarkCommandService` in deterministic parent-before-child order. Store progress in a durable task. Partial failures remain reviewable and resumable.

- [x] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/backup/conflict-detector.test.ts tests/integration/backup-import-apply.test.ts tests/unit/ui/import-preview.test.tsx`  
Expected: preview, safe defaults, partial failure, resume, and undo tests PASS.

```bash
git add src/backup src/ui/backup tests/unit/backup tests/integration/backup-import-apply.test.ts tests/unit/ui/import-preview.test.tsx
git commit -m "feat: 实现备份冲突预览与恢复"
```

### Task 6: Implement recycle bin, archive, and special-folder binding

**Files:**
- Create: `src/bookmarks/special-folders.ts`
- Create: `src/bookmarks/recycle-service.ts`
- Create: `src/bookmarks/archive-service.ts`
- Create: `src/tasks/handlers/purge-recycle-bin.ts`
- Modify: `src/ui/manager/BookmarkContextMenu.tsx`
- Modify: `src/ui/manager/FolderContextMenu.tsx`
- Modify: `src/ui/manager/DetailPanel.tsx`
- Test: `tests/integration/special-folders.test.ts`
- Test: `tests/integration/recycle-archive.test.ts`

**Interfaces:**
- Produces: `SpecialFolderService.bind/check`, `RecycleService.recycle/restore`, `ArchiveService.archive/restore`.

- [x] **Step 1: Write ID-binding tests**

Moving/renaming a bound folder preserves health. Deleting it pauses the feature and returns `missing-special-folder`; no folder is silently recreated by name.

- [x] **Step 2: Implement recycle and archive**

Record original parent/index before moving. Restore to the original location when valid or require a destination choice. Purge recycle contents only after 30 days and only through an explicit or scheduled cleanup task.

Wire archive, recycle, restore, and missing-folder recovery into the manager context menus and detail panel; all commands must display their actual destination before applying.

- [x] **Step 3: Verify and commit**

Run: `pnpm test -- tests/integration/special-folders.test.ts tests/integration/recycle-archive.test.ts`  
Expected: bind, missing, recycle, archive, restore, retention, and undo PASS.

```bash
git add src/bookmarks src/tasks/handlers/purge-recycle-bin.ts tests/integration/special-folders.test.ts tests/integration/recycle-archive.test.ts
git commit -m "feat: 完成归档回收站与特殊文件夹"
```

### Task 7: Build resumable onboarding and tiered reset

**Files:**
- Create: `src/onboarding/types.ts`
- Create: `src/onboarding/onboarding-store.ts`
- Create: `src/ui/onboarding/OnboardingWizard.tsx`
- Create: `src/ui/onboarding/PermissionStep.tsx`
- Create: `src/ui/onboarding/SpecialFoldersStep.tsx`
- Create: `src/ui/onboarding/ModelStep.tsx`
- Create: `src/ui/onboarding/MigrationStep.tsx`
- Create: `src/ui/onboarding/ScanStep.tsx`
- Create: `src/settings/reset-service.ts`
- Create: `src/ui/options/ResetSection.tsx`
- Test: `tests/unit/ui/onboarding-wizard.test.tsx`
- Test: `tests/integration/reset-service.test.ts`

**Interfaces:**
- Produces: resumable onboarding state, `ResetService.preview`, `ResetService.execute`.

- [ ] **Step 1: Write onboarding resume tests**

Assert every step can be skipped, progress survives close/reopen, model configuration is optional, files are user-selected, first scan is read-only, and no recurring job is enabled implicitly.

- [ ] **Step 2: Implement six onboarding steps**

Use the approved sequence: permissions/privacy, special folders, floating button, optional model, MarkAI file selection, read-only existing-bookmark scan.

- [ ] **Step 3: Implement tiered reset preview**

Support cache/thumbnails, AI metadata/index, history/tasks, model configuration, or all Siftmark data. Preview exact row/byte counts. High-risk reset requires the Chinese confirmation phrase `重置 Siftmark` and offers backup first. Native bookmarks are never removed.

- [ ] **Step 4: Verify and pass Gate 5**

Run: `pnpm typecheck && pnpm lint && pnpm test -- tests/unit/backup tests/unit/ui/onboarding-wizard.test.tsx tests/integration/backup-import-apply.test.ts tests/integration/recycle-archive.test.ts tests/integration/reset-service.test.ts && pnpm build`  
Expected: all migration, archive, onboarding, reset, and build tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/onboarding src/ui/onboarding src/settings src/ui/options/ResetSection.tsx tests
git commit -m "feat: 完成首次引导与安全重置"
```

Update Gate 5 in the master plan and commit `docs: 记录迁移安全阶段验收结果`.
