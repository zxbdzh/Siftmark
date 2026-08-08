import type { ProviderErrorKind } from './errors';

export interface RequestMetric {
  requestId: string;
  profileId: string;
  model: string;
  taskType: string;
  status: 'success' | ProviderErrorKind;
  latency: number;
  tokens?: number;
  createdAt: number;
}
