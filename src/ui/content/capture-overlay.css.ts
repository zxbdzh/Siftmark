export const captureOverlayStyles = `
:host {
  color-scheme: light;
  --siftmark-paper: #f7f8fa;
  --siftmark-ink: #171a1f;
  --siftmark-muted: #667085;
  --siftmark-line: #d9dee7;
  --siftmark-blue: #3e63dd;
  --siftmark-blue-pressed: #2f4fc0;
  --siftmark-risk: #d97706;
  --siftmark-danger: #c2413b;
  --siftmark-success: #2f8f5b;
  --siftmark-accent: var(--siftmark-blue);
  --siftmark-motion-fast: 100ms;
  --siftmark-motion-base: 160ms;
  --siftmark-motion-slow: 220ms;
  --siftmark-ease-out: cubic-bezier(.23, 1, .32, 1);
  font-family: "Noto Sans SC", "Microsoft YaHei UI", system-ui, sans-serif;
  font-synthesis: none;
  letter-spacing: 0;
}

* {
  box-sizing: border-box;
}

button {
  font: inherit;
  letter-spacing: 0;
}

.siftmark-capture-overlay {
  position: fixed;
  top: max(18px, env(safe-area-inset-top));
  right: max(18px, env(safe-area-inset-right));
  z-index: 2147483647;
  width: min(408px, calc(100vw - 28px));
  max-height: calc(100vh - 36px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--siftmark-line);
  border-top: 3px solid var(--siftmark-accent);
  border-radius: 8px;
  background: var(--siftmark-paper);
  color: var(--siftmark-ink);
  box-shadow: 0 18px 50px rgb(23 26 31 / 20%), 0 2px 8px rgb(23 26 31 / 8%);
  transition: border-color var(--siftmark-motion-base) var(--siftmark-ease-out);
}

.siftmark-capture-overlay[data-phase="approval"] {
  --siftmark-accent: var(--siftmark-risk);
}

.siftmark-capture-overlay[data-phase="saved"] {
  --siftmark-accent: var(--siftmark-success);
}

.siftmark-capture-overlay[data-phase="rejected"] {
  --siftmark-accent: #667085;
}

.siftmark-capture-overlay[data-phase="error"] {
  --siftmark-accent: var(--siftmark-danger);
}

.siftmark-overlay-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 32px;
  gap: 10px;
  align-items: center;
  padding: 14px 14px 12px;
  background: rgb(247 248 250 / 86%);
  box-shadow: 0 1px 0 rgb(217 222 231 / 72%);
  backdrop-filter: blur(16px) saturate(135%);
  -webkit-backdrop-filter: blur(16px) saturate(135%);
}

.siftmark-agent-mark {
  position: relative;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid #cbd3df;
  border-radius: 6px;
  background: #fff;
  color: var(--siftmark-accent);
  transition:
    color var(--siftmark-motion-base) var(--siftmark-ease-out),
    border-color var(--siftmark-motion-base) var(--siftmark-ease-out);
}

[data-phase="processing"] .siftmark-agent-mark {
  border-color: rgb(62 99 221 / 42%);
  box-shadow: 0 0 0 3px rgb(62 99 221 / 8%);
}

[data-phase="approval"] .siftmark-agent-mark,
[data-phase="error"] .siftmark-agent-mark {
  border-color: color-mix(in srgb, var(--siftmark-accent) 42%, white);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--siftmark-accent) 8%, transparent);
}

.siftmark-agent-mark::after {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--siftmark-paper);
  border-radius: 50%;
  background: var(--siftmark-accent);
  content: "";
  transition:
    background-color var(--siftmark-motion-base) var(--siftmark-ease-out),
    transform var(--siftmark-motion-base) var(--siftmark-ease-out);
}

.siftmark-agent-mark svg {
  width: 17px;
  height: 17px;
  stroke-width: 1.8;
}

.siftmark-overlay-heading-group {
  min-width: 0;
}

.siftmark-overlay-eyebrow {
  display: block;
  margin-bottom: 2px;
  color: var(--siftmark-accent);
  font: 600 10px/1.2 "Space Grotesk", "Noto Sans SC", system-ui, sans-serif;
  letter-spacing: 0;
  text-transform: uppercase;
  transition: color var(--siftmark-motion-base) var(--siftmark-ease-out);
}

.siftmark-overlay-header h2 {
  overflow-wrap: anywhere;
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: 0;
}

.siftmark-icon-button {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #707785;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    transform var(--siftmark-motion-fast) var(--siftmark-ease-out),
    background-color var(--siftmark-motion-base) var(--siftmark-ease-out),
    color var(--siftmark-motion-base) var(--siftmark-ease-out);
}

.siftmark-icon-button svg {
  width: 16px;
  height: 16px;
}

.siftmark-processing-line {
  height: 2px;
  overflow: hidden;
  background: #e4e8ef;
}

.siftmark-processing-line span {
  display: block;
  width: 42%;
  height: 100%;
  background: var(--siftmark-blue);
  animation: siftmark-progress 1.25s var(--siftmark-ease-out) infinite;
  will-change: transform;
}

.siftmark-processing-trace {
  padding: 11px 14px 13px;
  border-bottom: 1px solid var(--siftmark-line);
  background: #fff;
}

.siftmark-trace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  color: var(--siftmark-muted);
  font-size: 10px;
  font-weight: 650;
  line-height: 1.2;
}

.siftmark-trace-heading span:last-child {
  padding: 2px 6px;
  border: 1px solid #dbe1ea;
  border-radius: 999px;
  background: var(--siftmark-paper);
  color: #596171;
  font-family: "Space Grotesk", "Noto Sans SC", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
}

.siftmark-processing-trace ol {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.siftmark-processing-trace li {
  position: relative;
  display: grid;
  grid-template-columns: 19px minmax(0, 1fr);
  gap: 8px;
  min-height: 30px;
  padding: 3px 0;
}

.siftmark-processing-trace li:not(:last-child)::after {
  position: absolute;
  top: 19px;
  bottom: -5px;
  left: 8px;
  width: 1px;
  background: #d9e0ea;
  content: "";
}

.siftmark-activity-icon {
  z-index: 1;
  display: grid;
  width: 17px;
  height: 17px;
  place-items: center;
  border-radius: 50%;
  background: #fff;
  color: #7c8798;
  transition:
    color var(--siftmark-motion-base) var(--siftmark-ease-out),
    transform var(--siftmark-motion-base) var(--siftmark-ease-out);
}

.siftmark-activity-icon svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.9;
}

[data-status="completed"] > .siftmark-activity-icon {
  color: #2f8f5b;
}

[data-status="running"] > .siftmark-activity-icon {
  color: var(--siftmark-blue);
  transform: scale(1.04);
}

[data-status="failed"] > .siftmark-activity-icon {
  color: #c2413b;
}

.siftmark-activity-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.siftmark-activity-copy strong {
  color: #353b46;
  font-size: 11px;
  font-weight: 610;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

[data-status="running"] .siftmark-activity-copy strong {
  color: #2f4fc0;
}

.siftmark-activity-copy small {
  display: -webkit-box;
  overflow: hidden;
  color: #707989;
  font-size: 9px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.siftmark-activity-copy dl {
  display: grid;
  gap: 0;
  margin: 4px 0 2px;
  border-top: 1px solid #edf0f4;
}

.siftmark-activity-copy dl > div {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 7px;
  padding: 3px 0;
  border-bottom: 1px solid #f0f2f6;
}

.siftmark-activity-copy dt,
.siftmark-activity-copy dd {
  min-width: 0;
  margin: 0;
  font-size: 9px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.siftmark-activity-copy dt {
  color: #818999;
}

.siftmark-activity-copy dd {
  color: #465064;
}

.siftmark-activity-duration {
  justify-self: start;
  color: #8a93a2;
  font: 500 9px/1.3 "Space Grotesk", "Noto Sans SC", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
}

.siftmark-overlay-field {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  margin: 0 14px;
  padding: 12px 0;
  border-top: 1px solid var(--siftmark-line);
}

.siftmark-field-label {
  padding-top: 2px;
  color: var(--siftmark-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.45;
}

.siftmark-route {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 1px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.siftmark-route li {
  display: inline-flex;
  min-width: 0;
  align-items: center;
}

.siftmark-route li > svg {
  width: 13px;
  height: 13px;
  flex: none;
  margin: 0 1px;
  color: #9aa2b1;
}

.siftmark-route-node {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: #343942;
  font-size: 12px;
  font-weight: 560;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.siftmark-route-node svg {
  width: 14px;
  height: 14px;
  flex: none;
  color: #7b8494;
}

.siftmark-route-new {
  padding: 2px 5px;
  border: 1px solid #e2a34e;
  border-radius: 4px;
  background: #fff9ec;
  color: #8d4d00;
}

.siftmark-route-new svg {
  color: var(--siftmark-risk);
}

.siftmark-title-field {
  align-items: baseline;
}

.siftmark-title-value {
  display: -webkit-box;
  overflow: hidden;
  color: #343942;
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.siftmark-overlay-message {
  margin: 0;
  padding: 0 14px 12px;
  color: #596171;
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.siftmark-overlay-actions {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--siftmark-line);
  background: rgb(247 248 250 / 88%);
  box-shadow: 0 -8px 18px rgb(23 26 31 / 6%);
  backdrop-filter: blur(16px) saturate(135%);
  -webkit-backdrop-filter: blur(16px) saturate(135%);
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity var(--siftmark-motion-base) var(--siftmark-ease-out),
    transform var(--siftmark-motion-slow) var(--siftmark-ease-out),
    background-color var(--siftmark-motion-base) var(--siftmark-ease-out);
}

.siftmark-result-actions {
  display: flex;
  justify-content: flex-end;
}

.siftmark-button {
  display: inline-flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 11px;
  border: 1px solid transparent;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 620;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    transform var(--siftmark-motion-fast) var(--siftmark-ease-out),
    background-color var(--siftmark-motion-base) var(--siftmark-ease-out),
    border-color var(--siftmark-motion-base) var(--siftmark-ease-out),
    color var(--siftmark-motion-base) var(--siftmark-ease-out);
}

.siftmark-button svg {
  width: 14px;
  height: 14px;
  flex: none;
}

.siftmark-button:disabled {
  opacity: .56;
  cursor: progress;
}

.siftmark-button-primary {
  background: var(--siftmark-blue);
  color: #fff;
}

.siftmark-button-secondary {
  border-color: #cbd2dc;
  background: #fff;
  color: #343942;
}

.siftmark-adjust-button {
  justify-self: start;
}

.siftmark-icon-button:focus-visible,
.siftmark-button:focus-visible {
  outline: 2px solid var(--siftmark-blue);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgb(62 99 221 / 13%);
}

@media (hover: hover) and (pointer: fine) {
  .siftmark-icon-button:hover {
    background: #eceff4;
    color: var(--siftmark-ink);
  }

  .siftmark-button-primary:hover:not(:disabled) {
    background: var(--siftmark-blue-pressed);
  }

  .siftmark-button-secondary:hover:not(:disabled) {
    border-color: #aeb7c5;
    background: #f0f2f6;
  }
}

.siftmark-icon-button:active,
.siftmark-button:active:not(:disabled) {
  transform: scale(.97);
  transition-duration: 70ms;
}

@starting-style {
  .siftmark-overlay-actions {
    opacity: 0;
    transform: translateY(4px);
  }
}

@keyframes siftmark-progress {
  from { transform: translateX(-110%); }
  to { transform: translateX(340%); }
}

@keyframes siftmark-spin {
  to { transform: rotate(360deg); }
}

.siftmark-activity-spinner {
  animation: siftmark-spin .9s linear infinite;
}

@media (max-width: 440px) {
  .siftmark-capture-overlay {
    top: max(10px, env(safe-area-inset-top));
    right: 10px;
    width: calc(100vw - 20px);
  }

  .siftmark-overlay-actions {
    grid-template-columns: 1fr 1fr;
  }

  .siftmark-adjust-button {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-self: stretch;
  }
}

@media (prefers-reduced-motion: reduce) {
  .siftmark-processing-line span,
  .siftmark-activity-spinner {
    animation: none;
  }

  .siftmark-processing-line span {
    width: 100%;
    transform: none;
  }

  .siftmark-capture-overlay,
  .siftmark-agent-mark,
  .siftmark-agent-mark::after,
  .siftmark-overlay-eyebrow,
  .siftmark-icon-button,
  .siftmark-activity-icon,
  .siftmark-overlay-actions,
  .siftmark-button {
    transition-duration: 1ms;
  }

  .siftmark-overlay-actions,
  .siftmark-icon-button:active,
  .siftmark-button:active:not(:disabled),
  [data-status="running"] > .siftmark-activity-icon {
    transform: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .siftmark-capture-overlay,
  .siftmark-overlay-header,
  .siftmark-overlay-actions {
    background: var(--siftmark-paper);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-contrast: more) {
  :host {
    --siftmark-muted: #475467;
    --siftmark-line: #8792a2;
    --siftmark-blue: #234bc4;
    --siftmark-blue-pressed: #16399f;
    --siftmark-risk: #a54700;
    --siftmark-danger: #9f2621;
    --siftmark-success: #176b3d;
  }

  .siftmark-capture-overlay {
    background: #fff;
    box-shadow: 0 12px 32px rgb(0 0 0 / 28%);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .siftmark-overlay-header,
  .siftmark-overlay-actions {
    background: #fff;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .siftmark-button-secondary,
  .siftmark-agent-mark {
    border-color: #667085;
  }
}
`;
