import { AiAdapterRegistry } from './adapter-registry';
import { AnthropicMessagesAdapter } from './adapters/anthropic-messages';
import { GeminiGenerateContentAdapter } from './adapters/gemini-generate-content';
import { OpenAiChatAdapter } from './adapters/openai-chat';
import { OpenAiResponsesAdapter } from './adapters/openai-responses';
import {
  MeteredAiAdapter,
  type AiUsageSink
} from './adapters/metered-adapter';

export function createDefaultAiAdapterRegistry(
  usage?: AiUsageSink
): AiAdapterRegistry {
  const registry = new AiAdapterRegistry();
  const adapters = [
    new OpenAiChatAdapter(),
    new OpenAiResponsesAdapter(),
    new AnthropicMessagesAdapter(),
    new GeminiGenerateContentAdapter()
  ];
  for (const adapter of adapters)
    registry.register(usage ? new MeteredAiAdapter(adapter, usage) : adapter);
  return registry;
}
