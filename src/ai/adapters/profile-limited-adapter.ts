import { ProviderError } from '../network/errors';
import { ProfileLimiter } from '../network/profile-limiter';
import type {
  AiProtocol,
  ModelProfile
} from '../types';
import type { AiAdapter } from './adapter';

export class ProfileLimitedAiAdapter implements AiAdapter {
  readonly protocol: AiProtocol;
  readonly reviewCaptureHistory?: AiAdapter['reviewCaptureHistory'];
  readonly embed?: AiAdapter['embed'];

  constructor(
    private readonly adapter: AiAdapter,
    private readonly limiter: ProfileLimiter
  ) {
    this.protocol = adapter.protocol;

    if (adapter.reviewCaptureHistory) {
      const reviewCaptureHistory = adapter.reviewCaptureHistory.bind(adapter);
      this.reviewCaptureHistory = (profile, context, signal) =>
        this.schedule(profile, signal, () =>
          reviewCaptureHistory(profile, context, signal)
        );
    }

    if (adapter.embed) {
      const embed = adapter.embed.bind(adapter);
      this.embed = (profile, texts, signal) =>
        this.schedule(profile, signal, () => embed(profile, texts, signal));
    }
  }

  testConnection(
    profile: ModelProfile,
    signal: AbortSignal
  ) {
    return this.schedule(profile, signal, () =>
      this.adapter.testConnection(profile, signal)
    );
  }

  analyze(
    profile: ModelProfile,
    context: Parameters<AiAdapter['analyze']>[1],
    signal: AbortSignal
  ) {
    return this.schedule(profile, signal, () =>
      this.adapter.analyze(profile, context, signal)
    );
  }

  private schedule<T>(
    profile: ModelProfile,
    signal: AbortSignal,
    operation: () => Promise<T>
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError());

    const scheduled = this.limiter.schedule(profileKey(profile), () => {
      if (signal.aborted) throw abortError();
      return operation();
    });

    return rejectOnAbort(scheduled, signal);
  }
}

function profileKey(profile: ModelProfile): string {
  return `${profile.id}@${profile.version}`;
}

function abortError(): ProviderError {
  return new ProviderError('abort', 'Provider request aborted');
}

function rejectOnAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}
