import type { AiAdapter } from './adapters/adapter';
import type { AiProtocol } from './types';

export class AiAdapterRegistry {
  private readonly adapters = new Map<AiProtocol, AiAdapter>();

  register(adapter: AiAdapter): void { this.adapters.set(adapter.protocol, adapter); }
  get(protocol: AiProtocol): AiAdapter | null { return this.adapters.get(protocol) ?? null; }
}
