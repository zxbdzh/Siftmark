<div align="center">

<img src="assets/icons/siftmark-128.png" alt="Siftmark" width="96" height="96" />

# Siftmark

[中文](README.md)

**A local-first AI bookmark manager for Chromium.** Native bookmarks stay the single source of truth; the AI only proposes, a local deterministic executor does the work.

<sub>// No account · No server · No telemetry</sub>

<br />

![Version](https://img.shields.io/badge/version-0.1.4-00f5ff)
![Chrome](https://img.shields.io/badge/Chrome-MV3-4285f4?logo=googlechrome&logoColor=white)
![Edge](https://img.shields.io/badge/Edge-MV3-0078d7?logo=microsoftedge&logoColor=white)
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=111)
![WXT](https://img.shields.io/badge/WXT-extension%20framework-8b5cf6)
![Node](https://img.shields.io/badge/Node-22-339933?logo=nodedotjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-vitest%20%2B%20playwright-f2a1c1)

</div>

---

## The problem

Native bookmarking is too slow: pick a folder, invent a title, never find it again. Siftmark turns capture into an agent pipeline — you press `Ctrl+D` as usual, the AI proposes an organization plan, a local executor applies it, and you only approve or ignore.

- Native `Ctrl+D` / the browser star is the main entry; `Ctrl+Shift+S` and context-menu capture share the same agent pipeline
- Bookmarks are always written to Chromium first: safe proposals file automatically, risky ones go to a configurable inbox with a web approval overlay
- **The model only produces structured proposals** — moves, renames, folder creation, duplicate merging and undo are performed by a local deterministic executor
- Optional sleep review: mines weak preferences from resolved results while idle, only influencing future suggestions
- The Popup shows the pending queue and recent results; the Side Panel hosts the capture agent's ongoing conversation

## Features

- 🗂 **Manager** — virtualized folder tree and bookmark list, detail editing, local/semantic search, review, drafts, notifications, stats
- 🤖 **Capture agent** — structured proposals + local executor; risky operations always require your approval
- 📏 **Local rules** — move, tag, skip AI, or inbox items by domain, URL, title or source folder
- 🧹 **Special folders** — archive, trash and inbox bound by native bookmark IDs; deleting a bound folder pauses its pipeline
- 💾 **Backup & restore** — Siftmark JSON/ZIP, browser Bookmark HTML, MarkAI JSON import, encrypted `.siftmark-backup` (key included); tiered reset never deletes native bookmarks

## Install

Current version `0.1.4`, developer-mode build only — not submitted to the Chrome Web Store or Edge Add-ons.

Requires Node.js 22 + pnpm 10:

```powershell
git clone https://github.com/zxbdzh/Siftmark.git
cd Siftmark
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

- **Chrome**: `chrome://extensions` → enable Developer mode → Load unpacked → select `.output/chrome-mv3`
- **Edge**: `edge://extensions` → enable Developer mode → Load unpacked → select the same directory

The first-run wizard has five steps, each skippable; native bookmarks save immediately even without a configured model.

### Permissions

Production builds request: `bookmarks` / `storage` / `tabs` / `scripting` + `<all_urls>` / `contextMenus` / `alarms` / `idle` / `sidePanel`; `notifications` is optional. API keys are stored in `chrome.storage.local`; model requests go directly to your configured provider. See [privacy & permissions](docs/privacy-and-permissions.md).

## Development

```powershell
pnpm dev
pnpm typecheck
pnpm lint
pnpm test           # vitest
pnpm test:e2e       # Playwright (local deterministic fixtures, no real API key)
pnpm zip
```

See the [development guide](docs/development.md) and [model protocols](docs/model-protocols.md).

## Docs

- [User guide](docs/user-guide.md) · [Development guide](docs/development.md) · [Architecture](docs/architecture.md)
- [Capture agent design](docs/design/2026-08-11-capture-agent.md) · [Model protocols](docs/model-protocols.md)
- [Backup & restore](docs/backup-and-restore.md) · [Privacy & permissions](docs/privacy-and-permissions.md)

## License

No open-source license is granted for the Siftmark source code. Third-party code, fonts and assets keep their own licenses — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
