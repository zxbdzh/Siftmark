import type { ProviderErrorKind } from '../network/errors';
import { ProviderError } from '../network/errors';
import type { RequestMetric } from '../network/request-metrics';
import type {
  AiAnalysisResult,
  AiProtocol,
  AiRequestContext,
  CapabilityProbe,
  ModelProfile
} from '../types';
import type { AiAdapter } from './adapter';

export interface AiUsageSink {
  add(metric: RequestMetric): Promise<void>;
}

export class MeteredAiAdapter implements AiAdapter {
  readonly protocol: AiProtocol;

  constructor(
    private readonly adapter: AiAdapter,
    private readonly usage: AiUsageSink,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {
    this.protocol = adapter.protocol;
  }

  testConnection(
    profile: ModelProfile,
    signal: AbortSignal
  ): Promise<CapabilityProbe> {
    return this.measure(
      profile,
      'connection-test',
      signal,
      () => this.adapter.testConnection(profile, signal),
      (result) => result.usageTokens
    );
  }

  analyze(
    profile: ModelProfile,
    context: AiRequestContext,
    signal: AbortSignal
  ): Promise<AiAnalysisResult> {
    return this.measure(
      profile,
      context.taskType ?? 'analysis',
      signal,
      () => this.adapter.analyze(profile, context, signal),
      (result) => result.usageTokens
    );
  }

  embed(
    profile: ModelProfile,
    texts: string[],
    signal: AbortSignal
  ): Promise<number[][]> {
    if (!this.adapter.embed)
      return Promise.reject(new Error('所选协议不支持向量请求'));
    return this.measure(
      profile,
      'embed',
      signal,
      () => this.adapter.embed!(profile, texts, signal)
    );
  }

  private async measure<T>(
    profile: ModelProfile,
    taskType: string,
    signal: AbortSignal,
    request: () => Promise<T>,
    readTokens?: (result: T) => number | undefined
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await request();
      await this.record({
        requestId: this.createId(),
        profileId: profile.id,
        model: profile.model,
        taskType,
        status: 'success',
        latency: Math.max(0, this.now() - startedAt),
        tokens: readTokens?.(result),
        createdAt: startedAt
      });
      return result;
    } catch (error) {
      await this.record({
        requestId: this.createId(),
        profileId: profile.id,
        model: profile.model,
        taskType,
        status: errorKind(error, signal),
        latency: Math.max(0, this.now() - startedAt),
        createdAt: startedAt
      });
      throw error;
    }
  }

  private async record(metric: RequestMetric): Promise<void> {
    await this.usage.add(metric).catch(() => undefined);
  }
}

function errorKind(error: unknown, signal: AbortSignal): ProviderErrorKind {
  if (signal.aborted) return 'abort';
  return error instanceof ProviderError ? error.kind : 'provider';
}
