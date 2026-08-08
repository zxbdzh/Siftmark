export const ONBOARDING_STEPS = [
  'permissions-privacy',
  'special-folders',
  'floating-button',
  'model',
  'migration',
  'read-only-scan'
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStateV1 {
  version: 1;
  status: 'in-progress' | 'completed';
  currentStep: OnboardingStepId | null;
  completedSteps: OnboardingStepId[];
  skippedSteps: OnboardingStepId[];
  updatedAt: number;
}
