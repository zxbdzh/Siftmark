import { ANALYSIS_PROMPT_VERSION, buildAnalysisPrompt } from './analysis-prompt';

export const promptRegistry = {
  [ANALYSIS_PROMPT_VERSION]: buildAnalysisPrompt
} as const;
