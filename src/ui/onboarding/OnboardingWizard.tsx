import { Check, ChevronRight, SkipForward } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ChromeOnboardingStore } from '../../onboarding/onboarding-store';
import {
  ONBOARDING_STEPS,
  type OnboardingStateV1,
  type OnboardingStepId
} from '../../onboarding/types';

const stepTitles: Record<OnboardingStepId, string> = {
  'permissions-privacy': '权限与隐私',
  'special-folders': '特殊文件夹',
  'floating-button': '网页悬浮按钮',
  model: '可选模型',
  migration: '迁移数据',
  'read-only-scan': '只读扫描'
};

interface OnboardingWizardProps {
  store: ChromeOnboardingStore;
  steps?: Partial<Record<OnboardingStepId, ReactNode>>;
  onComplete?(): void;
}

export function OnboardingWizard({
  store,
  steps = {},
  onComplete
}: OnboardingWizardProps) {
  const [state, setState] = useState<OnboardingStateV1>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void store.load().then((value) => {
      if (active) setState(value);
    });
    return () => {
      active = false;
    };
  }, [store]);

  if (!state) return <p className="onboarding-loading">正在读取设置…</p>;
  if (state.status === 'completed' || !state.currentStep) return null;

  const currentStep = state.currentStep;
  const stepIndex = ONBOARDING_STEPS.indexOf(currentStep);
  const advance = async (skip: boolean) => {
    setBusy(true);
    try {
      const next = skip
        ? await store.skipStep(currentStep)
        : await store.completeStep(currentStep);
      setState(next);
      if (next.status === 'completed') onComplete?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="onboarding-wizard" aria-labelledby="onboarding-title">
      <header>
        <div>
          <span>
            步骤 {stepIndex + 1} / {ONBOARDING_STEPS.length}
          </span>
          <h2 id="onboarding-title">{stepTitles[currentStep]}</h2>
        </div>
        <progress value={stepIndex + 1} max={ONBOARDING_STEPS.length}>
          {stepIndex + 1} / {ONBOARDING_STEPS.length}
        </progress>
      </header>
      <div className="onboarding-step">{steps[currentStep] ?? null}</div>
      <footer>
        <button
          type="button"
          disabled={busy}
          onClick={() => void advance(true)}
        >
          <SkipForward size={16} />
          跳过此步
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void advance(false)}
        >
          {stepIndex === ONBOARDING_STEPS.length - 1 ? (
            <Check size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
          {stepIndex === ONBOARDING_STEPS.length - 1
            ? '完成引导'
            : '完成并继续'}
        </button>
      </footer>
    </section>
  );
}
