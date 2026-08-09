export type AiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini-generate-content';
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
}

export interface AiRequestContext {
  title: string;
  url: string;
  currentFolderPath: string[];
  description?: string;
  pageText?: string;
  additionalRules?: string;
  availableFolderPaths?: string[];
  folderCreationPolicy?: 'off' | 'weak' | 'medium' | 'strong';
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
