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
  --siftmark-agent: #b7ff36;
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
  overflow: hidden;
  border: 1px solid var(--siftmark-line);
  border-top: 3px solid var(--siftmark-blue);
  border-radius: 8px;
  background: var(--siftmark-paper);
  color: var(--siftmark-ink);
  box-shadow: 0 18px 50px rgb(23 26 31 / 20%), 0 2px 8px rgb(23 26 31 / 8%);
  animation: siftmark-enter 180ms cubic-bezier(.2, .7, .2, 1) both;
}

.siftmark-capture-overlay[data-phase="approval"],
.siftmark-capture-overlay[data-phase="error"] {
  border-top-color: var(--siftmark-risk);
}

.siftmark-overlay-header {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 32px;
  gap: 10px;
  align-items: center;
  padding: 14px 14px 12px;
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
}

.siftmark-agent-mark::after {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--siftmark-paper);
  border-radius: 50%;
  background: var(--siftmark-agent);
  content: "";
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
  color: var(--siftmark-risk);
  font: 600 10px/1.2 "Space Grotesk", "Noto Sans SC", system-ui, sans-serif;
  letter-spacing: 0;
  text-transform: uppercase;
}

[data-phase="processing"] .siftmark-overlay-eyebrow,
[data-phase="saved"] .siftmark-overlay-eyebrow {
  color: var(--siftmark-blue);
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
}

.siftmark-icon-button:hover {
  background: #eceff4;
  color: var(--siftmark-ink);
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
  animation: siftmark-progress 1.2s ease-in-out infinite;
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--siftmark-line);
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
}

.siftmark-button svg {
  width: 14px;
  height: 14px;
  flex: none;
}

.siftmark-button:disabled {
  opacity: .56;
  cursor: wait;
}

.siftmark-button-primary {
  background: var(--siftmark-blue);
  color: #fff;
}

.siftmark-button-primary:hover:not(:disabled) {
  background: var(--siftmark-blue-pressed);
}

.siftmark-button-secondary {
  border-color: #cbd2dc;
  background: #fff;
  color: #343942;
}

.siftmark-button-secondary:hover:not(:disabled) {
  border-color: #aeb7c5;
  background: #f0f2f6;
}

.siftmark-adjust-button {
  justify-self: start;
}

.siftmark-icon-button:focus-visible,
.siftmark-button:focus-visible {
  outline: 2px solid var(--siftmark-blue);
  outline-offset: 2px;
}

@keyframes siftmark-enter {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
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
  .siftmark-capture-overlay,
  .siftmark-processing-line span,
  .siftmark-activity-spinner {
    animation: none;
  }
}
`;
