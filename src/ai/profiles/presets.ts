import type { AiProtocol, AiStructuredOutput } from '../types';

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  structuredOutput: AiStructuredOutput;
}

export const providerPresets: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-responses', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', structuredOutput: 'json_schema' },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic-messages', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', structuredOutput: 'prompt-only' },
  { id: 'gemini', name: 'Gemini', protocol: 'gemini-generate-content', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', structuredOutput: 'json_schema' },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-chat', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-flash', structuredOutput: 'json_object' },
  { id: 'qwen', name: '通义千问', protocol: 'openai-chat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', structuredOutput: 'json_object' },
  { id: 'zhipu', name: '智谱', protocol: 'openai-chat', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', structuredOutput: 'json_object' },
  { id: 'doubao', name: '豆包', protocol: 'openai-chat', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro', structuredOutput: 'json_object' },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-chat', endpoint: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01', structuredOutput: 'json_object' },
  { id: 'ollama', name: 'Ollama', protocol: 'openai-chat', endpoint: 'http://127.0.0.1:11434/v1', model: 'qwen2.5', structuredOutput: 'prompt-only' }
];
