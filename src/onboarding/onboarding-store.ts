import {
  ONBOARDING_STEPS,
  type OnboardingStateV1,
  type OnboardingStepId
} from './types';

export { ONBOARDING_STEPS } from './types';

export const ONBOARDING_STORAGE_KEY = 'siftmark.onboarding.v1';

export interface OnboardingStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class ChromeOnboardingStore {
  constructor(
    private readonly storage: OnboardingStorageArea,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<OnboardingStateV1> {
    const value = (await this.storage.get(ONBOARDING_STORAGE_KEY))[
      ONBOARDING_STORAGE_KEY
    ];
    return isOnboardingState(value) ? value : initialState(this.now());
  }

  completeStep(step: OnboardingStepId): Promise<OnboardingStateV1> {
    return this.advance(step, false);
  }

  skipStep(step: OnboardingStepId): Promise<OnboardingStateV1> {
    return this.advance(step, true);
  }

  private async advance(
    step: OnboardingStepId,
    skipped: boolean
  ): Promise<OnboardingStateV1> {
    const current = await this.load();
    if (current.status === 'completed') return current;
    if (current.currentStep !== step) {
      throw new Error(`Onboarding step ${step} is not active`);
    }
    const index = ONBOARDING_STEPS.indexOf(step);
    const nextStep = ONBOARDING_STEPS[index + 1] ?? null;
    const next: OnboardingStateV1 = {
      version: 1,
      status: nextStep ? 'in-progress' : 'completed',
      currentStep: nextStep,
      completedSteps: skipped
        ? current.completedSteps
        : unique([...current.completedSteps, step]),
      skippedSteps: skipped
        ? unique([...current.skippedSteps, step])
        : current.skippedSteps.filter((candidate) => candidate !== step),
      updatedAt: this.now()
    };
    await this.storage.set({ [ONBOARDING_STORAGE_KEY]: next });
    return next;
  }
}

function initialState(now: number): OnboardingStateV1 {
  return {
    version: 1,
    status: 'in-progress',
    currentStep: ONBOARDING_STEPS[0],
    completedSteps: [],
    skippedSteps: [],
    updatedAt: now
  };
}

function isOnboardingState(value: unknown): value is OnboardingStateV1 {
  if (!isRecord(value) || value.version !== 1) return false;
  if (value.status !== 'in-progress' && value.status !== 'completed')
    return false;
  if (
    value.currentStep !== null &&
    !ONBOARDING_STEPS.includes(value.currentStep as OnboardingStepId)
  )
    return false;
  return (
    Array.isArray(value.completedSteps) &&
    value.completedSteps.every(isStep) &&
    Array.isArray(value.skippedSteps) &&
    value.skippedSteps.every(isStep) &&
    typeof value.updatedAt === 'number'
  );
}

function isStep(value: unknown): value is OnboardingStepId {
  return ONBOARDING_STEPS.includes(value as OnboardingStepId);
}

function unique(values: OnboardingStepId[]): OnboardingStepId[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
