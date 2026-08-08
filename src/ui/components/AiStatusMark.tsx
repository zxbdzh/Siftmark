import type { CSSProperties } from 'react';

export type AiStatusState = 'idle' | 'analyzing' | 'success' | 'paused';

export interface AiStatusMarkProps {
  state: AiStatusState;
  label: string;
  size?: number;
}

export function AiStatusMark({ state, label, size = 24 }: AiStatusMarkProps) {
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const animated = !reduced && (state === 'idle' || state === 'analyzing');
  const style = { '--mark-size': `${size}px` } as CSSProperties;
  return (
    <span className="ai-status-mark" role="img" aria-label={label} data-state={state} data-motion={animated ? 'animated' : 'static'} style={style}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z" fill={state === 'analyzing' ? '#b7ff36' : 'currentColor'} />
        <path d="M15 13h5v8l-2.5-1.7L15 21v-8Z" fill="currentColor" />
      </svg>
    </span>
  );
}
