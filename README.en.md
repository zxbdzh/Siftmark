# Siftmark

Siftmark is a local-first AI bookmark manager for Chromium. Native Chrome/Edge bookmarks stay the single source of truth for titles, URLs, folders and order — Siftmark only stores tags, summaries, notes, review proposals, indexes and task records on your machine.

[中文](README.md)

> Note: the current build is distributed for developer-mode loading only; it is not submitted to the Chrome Web Store or Edge Add-ons. No account, no self-hosted server, no telemetry.

## How it works

- The native `Ctrl+D` / browser star is the primary capture entry; `Ctrl+Shift+S` and the context menu share the same agent pipeline.
- Bookmarks are always written to Chromium first. Safe proposals are filed automatically; risky ones go to a configurable inbox with a web approval overlay.
- The model only produces structured proposals — a local deterministic executor performs moves, renames, folder creation, duplicate merging and undo.
- Optional sleep review mines weak preferences from resolved results while you're idle; it only influences future suggestions and never touches bookmarks directly.
- The manager offers a virtualized folder tree and bookmark list, detail editing, local/semantic search, review, drafts, notifications and stats.
- Local rules can move, tag, skip AI, or inbox items by domain, URL, title or source folder.
- Backups: Siftmark JSON/ZIP, browser Bookmark HTML, MarkAI JSON import, plus encrypted `.siftmark-backup` (key included). Tiered reset never deletes native bookmarks.

## Requirements & permissions

Production builds request: `bookmarks`, `storage`, `tabs`, `scripting` + `<all_urls>`, `contextMenus`, `alarms`, `idle`, `sidePanel`. `notifications` is optional. API keys are stored in `chrome.storage.local`; model requests go directly to the provider you configure. See [privacy & permissions](docs/privacy-and-permissions.md).

## Build & load

Requires Node.js 22 and pnpm 10:

```powershell
git clone https://github.com/zxbdzh/Siftmark.git
cd Siftmark
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Chrome: open `chrome://extensions`, enable Developer mode, "Load unpacked", select `.output/chrome-mv3`.
Edge: open `edge://extensions`, enable Developer mode, "Load unpacked", select the same directory.

## Docs

User guide, development guide, architecture, capture-agent design, model protocols, backup & restore, privacy, and performance baselines all live in [docs/](docs/).

## License

No open-source license is granted for the Siftmark source code. Third-party code, fonts and assets keep their own licenses — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
