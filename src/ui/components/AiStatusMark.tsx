import { lazy, Suspense, type CSSProperties } from 'react';
import idleAnimation from '../../../assets/lottie/idle.json';
import analyzingAnimation from '../../../assets/lottie/analyzing.json';
import successAnimation from '../../../assets/lottie/success.json';
import pausedAnimation from '../../../assets/lottie/paused.json';

export type AiStatusState = 'idle' | 'analyzing' | 'success' | 'paused';

export interface AiStatusMarkProps {
  state: AiStatusState;
  label: string;
  size?: number;
}

const animations = { idle: idleAnimation, analyzing: analyzingAnimation, success: successAnimation, paused: pausedAnimation };
const Lottie = lazy(async () => { const module = await import('lottie-react'); return { default: module.default }; });

export function AiStatusMark({ state, label, size = 24 }: AiStatusMarkProps) {
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const animated = !reduced;
  const style = { '--mark-size': `${size}px`, width: size, height: size } as CSSProperties;
  const fallback = <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z" fill={state === 'analyzing' ? '#b7ff36' : 'currentColor'}/><path d="M15 13h5v8l-2.5-1.7L15 21v-8Z" fill="currentColor"/></svg>;
  return <span className="ai-status-mark" role="img" aria-label={label} data-state={state} data-motion={animated ? 'animated' : 'static'} style={style}>{animated ? <Suspense fallback={fallback}><Lottie animationData={animations[state]} loop={state === 'idle' || state === 'analyzing'} autoplay rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }} aria-hidden="true"/></Suspense> : fallback}</span>;
}
