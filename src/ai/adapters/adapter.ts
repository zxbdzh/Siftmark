import type {
  AiAnalysisResult,
  AiCaptureReviewContext,
  AiCaptureReviewResult,
  AiProtocol,
  AiRequestContext,
  CapabilityProbe,
  ModelProfile
} from '../types';
import type {
  AiOrganizationContext,
  AiOrganizationResult
} from '../organization-types';

export interface AiAdapter {
  readonly protocol: AiProtocol;
  testConnection(
    profile: ModelProfile,
    signal: AbortSignal
  ): Promise<CapabilityProbe>;
  analyze(
    profile: ModelProfile,
    context: AiRequestContext,
    signal: AbortSignal
  ): Promise<AiAnalysisResult>;
  planOrganization?(
    profile: ModelProfile,
    context: AiOrganizationContext,
    signal: AbortSignal
  ): Promise<AiOrganizationResult>;
  reviewCaptureHistory?(
    profile: ModelProfile,
    context: AiCaptureReviewContext,
    signal: AbortSignal
  ): Promise<AiCaptureReviewResult>;
  embed?(
    profile: ModelProfile,
    texts: string[],
    signal: AbortSignal
  ): Promise<number[][]>;
}
