import { AiAdapterRegistry } from './adapter-registry';
import { AnthropicMessagesAdapter } from './adapters/anthropic-messages';
import { GeminiGenerateContentAdapter } from './adapters/gemini-generate-content';
import { OpenAiChatAdapter } from './adapters/openai-chat';
import { OpenAiResponsesAdapter } from './adapters/openai-responses';
import {
  MeteredAiAdapter,
  type AiUsageSink
} from './adapters/metered-adapter';
import { ProfileLimitedAiAdapter } from './adapters/profile-limited-adapter';
import { ProfileLimiter } from './network/profile-limiter';

export function createDefaultAiAdapterRegistry(
  usage?: AiUsageSink
): AiAdapterRegistry {
  const registry = new AiAdapterRegistry();
  const limiter = new ProfileLimiter(2);
  const adapters = [
    new OpenAiChatAdapter(),
    new OpenAiResponsesAdapter(),
    new AnthropicMessagesAdapter(),
    new GeminiGenerateContentAdapter()
  ];
  for (const adapter of adapters) {
    const metered = usage ? new MeteredAiAdapter(adapter, usage) : adapter;
    registry.register(new ProfileLimitedAiAdapter(metered, limiter));
  }
  return registry;
}
