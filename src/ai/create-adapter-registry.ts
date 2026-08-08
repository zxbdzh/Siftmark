import { AiAdapterRegistry } from './adapter-registry';
import { AnthropicMessagesAdapter } from './adapters/anthropic-messages';
import { GeminiGenerateContentAdapter } from './adapters/gemini-generate-content';
import { OpenAiChatAdapter } from './adapters/openai-chat';
import { OpenAiResponsesAdapter } from './adapters/openai-responses';

export function createDefaultAiAdapterRegistry(): AiAdapterRegistry {
  const registry = new AiAdapterRegistry();
  registry.register(new OpenAiChatAdapter());
  registry.register(new OpenAiResponsesAdapter());
  registry.register(new AnthropicMessagesAdapter());
  registry.register(new GeminiGenerateContentAdapter());
  return registry;
}
