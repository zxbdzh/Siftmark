import type { AiAnalysisResult, AiProtocol, AiRequestContext, CapabilityProbe, ModelProfile } from '../types';

export interface AiAdapter {
  readonly protocol: AiProtocol;
  testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe>;
  analyze(profile: ModelProfile, context: AiRequestContext, signal: AbortSignal): Promise<AiAnalysisResult>;
  embed?(profile: ModelProfile, texts: string[], signal: AbortSignal): Promise<number[][]>;
}
