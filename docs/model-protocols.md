# 模型协议

Siftmark 直接调用用户配置的 Endpoint，不经过 Siftmark 服务端。模型档案由 `id + version` 标识，包含协议、Endpoint、模型、API Key、超时、能力和状态。

## 通用约束

- Endpoint 必须为 HTTPS；仅 `localhost`、`127.0.0.1`、`[::1]` 可使用 HTTP。
- 超时解析后限制在 5,000–120,000 ms。
- 档案先保存为草稿，连接探测成功后变为 `verified`，才可绑定能力。
- 能力为 `classify`、`rename`、`summarize`、`embed`；任务锁定档案版本。
- 文本输出必须是固定 JSON Schema：`folderPath`（最多 5 层）、`title`、`tags`、`summary`、`confidence` 和 `reason`，拒绝额外字段。
- HTTP `401/403/429/5xx`、`Retry-After`、超时、中止、无效 JSON 和无效 Schema 被映射为统一错误。

Endpoint 填写协议根地址。适配器会去掉末尾 `/` 并追加下表路径，不要把 `chat/completions` 等操作路径重复填入 Endpoint。

## OpenAI Chat Completions

协议值：`openai-chat`

- 分析：`POST {endpoint}/chat/completions`
- Embedding：`POST {endpoint}/embeddings`
- 认证：`Authorization: Bearer <API Key>`
- 分析请求：`model`、system/user `messages`、`response_format.type=json_schema` 与 strict Schema。
- 文本响应：`choices[0].message.content`，内容再经本地 JSON/Zod 校验；增强请求成功但无文本时，会移除联网与图片参数降级重试一次。
- Embedding 请求：`model`、`input[]`、`encoding_format=float`。

适用于 OpenAI Chat 兼容服务。DeepSeek、通义千问、智谱、豆包、MiniMax 和 Ollama 预置均复用此适配器；预置只是可编辑默认值，不保证服务商账号、模型可用性或长期兼容性。

## OpenAI Responses

协议值：`openai-responses`

- 分析：`POST {endpoint}/responses`
- Embedding：`POST {endpoint}/embeddings`
- 认证：`Authorization: Bearer <API Key>`
- 分析请求：`model`、`instructions`、`input`、`text.format.type=json_schema`；启用识图时加入 Base64 JPEG `input_image`，启用联网时加入 `tools=[{type:web_search}]` 与 `tool_choice=required`。
- 文本响应：优先使用非空 `output_text`，否则查找 `output[].content[]` 的非空 `output_text`；增强请求成功但无文本时，会移除联网与图片参数降级重试一次。

OpenAI 预置默认使用此协议。Embedding 与 Chat 协议共享 OpenAI 兼容形状。

## Anthropic Messages

协议值：`anthropic-messages`

- 分析：`POST {endpoint}/messages`
- 认证：`x-api-key` 与 `anthropic-version: 2023-06-01`
- 请求：`model`、`max_tokens`、顶层 `system`、user `messages`。
- 响应：首个 `content[]` 文本块；`stop_reason=max_tokens` 视为不完整并拒绝。
- 当前适配器不提供 Embedding；档案不要声明 `embed`。

Anthropic 原生 Messages 没有使用 OpenAI 的 `response_format`。Siftmark 在提示中要求唯一 JSON，并仍执行相同的本地严格 Schema 校验。

## Gemini generateContent

协议值：`gemini-generate-content`

- 分析：`POST {endpoint}/models/{url-encoded-model}:generateContent`
- Embedding：`POST {endpoint}/models/{url-encoded-model}:batchEmbedContents`
- 认证：`x-goog-api-key`
- 分析请求：`systemInstruction`、user `contents`、`generationConfig.responseMimeType=application/json` 和 `responseJsonSchema`。
- 响应：`candidates[0].content.parts[].text`；block reason 或非 `STOP` finish reason 被拒绝。
- Embedding 使用 `taskType=RETRIEVAL_DOCUMENT`。

## 连接测试

文本能力探测会发送代表性的收藏分析请求，并要求模型返回完整六字段结果。声明 `embed` 时还会发送单项 `siftmark` 向量探测，并检查数量、维度非空和所有数值有限。只有声明的能力全部通过，档案才可启用。

测试连接会产生真实供应商请求，可能受配额或计费规则影响。Siftmark 不提供预算上限；本地用量页只记录模型、任务、Token（若服务商提供）、延迟和状态，不保存请求正文或 API Key。

## 添加服务商预置

若服务商兼容现有协议，只修改 `src/ai/profiles/presets.ts`：

```ts
{
  id: 'example',
  name: 'Example',
  protocol: 'openai-chat',
  endpoint: 'https://api.example.com/v1',
  model: 'example-model'
}
```

补充预置选择测试和本地夹具请求断言。不要添加服务商专用请求体、任意 Header 编辑器、JSONPath 或可执行脚本。只有 wire protocol 实质不同且能够维持固定安全边界时才新增适配器。

## 故障排查

- `authentication/authorization`：检查 API Key、账号权限和认证协议。
- `rate-limit`：查看服务商配额和 `Retry-After`；不要并行重复点击。
- `validation`：代理可能不支持 strict Schema，或响应包含 Markdown/额外字段/截断 JSON。
- `network`：检查 Endpoint、证书、代理和扩展网站访问权限。
- `abort`：请求超时、用户取消或 Worker 中断；中断中的分析任务标为结果未知，不自动重发。
