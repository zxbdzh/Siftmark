export type AiProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-generate-content';
export type AiCapability = 'classify' | 'rename' | 'summarize' | 'embed';

export interface ModelProfile {
  id: string;
  version: string;
  name: string;
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  capabilities: AiCapability[];
  state: 'draft' | 'verified' | 'disabled';
  verifiedAt?: number;
}

export interface AiAnalysisResult {
  folderPath: string[];
  title: string;
  tags: string[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  usageTokens?: number;
  toolUsage?: {
    vision?: boolean;
    webSearch?: 'used' | 'requested' | 'not-used';
  };
}

export type AiCaptureReviewResolution =
  | 'auto'
  | 'allowed'
  | 'rejected'
  | 'undone';

export interface AiCaptureReviewExample {
  sessionId: string;
  domain: string;
  title: string;
  destinationPath: string[];
  resolution: AiCaptureReviewResolution;
  tags: string[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface AiCaptureReviewContext {
  examples: AiCaptureReviewExample[];
}

export interface AiCaptureReviewMemory {
  domain: string;
  action: 'prefer-folder' | 'avoid-folder';
  destinationPath: string[];
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}

export interface AiCaptureReviewResult {
  memories: AiCaptureReviewMemory[];
  reviewSummary: string;
  usageTokens?: number;
}

export interface AiRequestContext {
  title: string;
  url: string;
  currentFolderPath: string[];
  description?: string;
  pageText?: string;
  /** Ephemeral current-viewport image. It is sent to the model but never persisted. */
  imageDataUrl?: string;
  webSearch?: boolean;
  additionalRules?: string;
  availableFolderPaths?: string[];
  relatedBookmarks?: Array<{
    title: string;
    url: string;
    summary?: string;
  }>;
  folderCreationPolicy?: 'off' | 'weak' | 'medium' | 'strong';
  maxNewFolderLevels?: number;
  preferredFolderDepth?: number;
  maxTitleLength?: number;
  taskType?: 'classify' | 'rename' | 'summarize' | 'analysis';
}

export interface CapabilityProbe {
  authentication: boolean;
  text: boolean;
  structuredOutput: boolean;
  embedding: boolean;
  usageTokens?: number;
}
