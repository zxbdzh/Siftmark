export type ProviderErrorKind = 'authentication' | 'authorization' | 'rate-limit' | 'provider' | 'network' | 'validation' | 'abort' | 'unknown-result';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'provider';
  return 'validation';
}
