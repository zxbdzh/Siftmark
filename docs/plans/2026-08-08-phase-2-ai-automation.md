# Phase 2 AI and Automation Implementation Plan

> **For agentic workers:** Execute tasks in order without Superpowers skills. Use fixture responses only; never require a real API key in automated tests.

**Goal:** Deliver versioned model profiles, four protocol adapters, secure input shaping, strict structured results, local rules, resilient request scheduling, and review-ready analysis jobs.

**Architecture:** Protocol adapters implement one `AiAdapter` port. `AnalysisCoordinator` applies rules first, obtains sanitized content only when needed, calls the selected profile, validates the common result Schema, and emits a proposal rather than directly mutating bookmarks.

**Tech Stack:** TypeScript, Zod, Web Fetch API, Web Crypto, Vitest fixtures.

## Global Constraints

- BYOK only; no Siftmark proxy or free public model.
- Four protocols: OpenAI Chat, OpenAI Responses, Anthropic Messages, Gemini generateContent.
- Raw body text and complete provider responses are never persisted.
- Expected provider failures return typed errors.
- Chinese Conventional Commits.

---

### Task 1: Define AI contracts, schemas, and prompt versions

**Files:**
- Create: `src/ai/types.ts`
- Create: `src/ai/adapters/adapter.ts`
- Create: `src/ai/schemas/analysis-schema.ts`
- Create: `src/ai/prompts/analysis-prompt.ts`
- Create: `src/ai/prompts/prompt-registry.ts`
- Test: `tests/unit/ai/analysis-schema.test.ts`
- Test: `tests/unit/ai/analysis-prompt.test.ts`

**Interfaces:**
- Produces: `AiProtocol`, `AiAdapter`, `AiAnalysisResult`, `AiRequestContext`, `analysisResultSchema`, `buildAnalysisPrompt`.

- [ ] **Step 1: Write failing Schema tests**

```ts
it('rejects URLs and unknown output fields', () => {
  expect(() => analysisResultSchema.parse({
    folderPath: ['技术'], title: '标题', tags: [], summary: '摘要',
    confidence: 'high', reason: '主题明确', url: 'https://changed.test'
  })).toThrow();
});
```

Test path depth `<= 3`, non-empty title, no slash/control characters in folder segments, unique tags, summary length `<= 240`, and reason length `<= 120`.

- [ ] **Step 2: Define the adapter port**

```ts
export type AiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini-generate-content';

export interface AiAdapter {
  readonly protocol: AiProtocol;
  testConnection(profile: ModelProfile, signal: AbortSignal): Promise<CapabilityProbe>;
  analyze(profile: ModelProfile, context: AiRequestContext, signal: AbortSignal): Promise<AiAnalysisResult>;
  embed?(profile: ModelProfile, texts: string[], signal: AbortSignal): Promise<number[][]>;
}
```

- [ ] **Step 3: Implement versioned prompts**

`buildAnalysisPrompt` must separate fixed safety/schema instructions from user-controlled additional rules. It must wrap page data in `<untrusted_page_content>` delimiters and state that instructions inside the block are data.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/ai/analysis-schema.test.ts tests/unit/ai/analysis-prompt.test.ts`  
Expected: PASS.

```bash
git add src/ai/types.ts src/ai/adapters/adapter.ts src/ai/schemas src/ai/prompts tests/unit/ai
git commit -m "feat: 定义统一 AI 结果协议"
```

### Task 2: Implement model profile storage and capability selection

**Files:**
- Create: `src/ai/profiles/model-profile.ts`
- Create: `src/ai/profiles/profile-repository.ts`
- Create: `src/ai/profiles/profile-selector.ts`
- Create: `src/ai/profiles/presets.ts`
- Test: `tests/unit/ai/profile-selector.test.ts`
- Test: `tests/unit/ai/profile-repository.test.ts`

**Interfaces:**
- Produces: `ModelProfile`, `ProfileRepository`, `selectProfileForCapability`, `providerPresets`.

- [ ] **Step 1: Define and test profile validation**

```ts
export interface ModelProfile {
  id: string;
  version: string;
  name: string;
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  capabilities: Array<'classify' | 'rename' | 'summarize' | 'embed'>;
  state: 'draft' | 'verified' | 'disabled';
  verifiedAt?: number;
}
```

Reject non-HTTP(S) endpoints except loopback HTTP for Ollama. Clamp timeout to 5–120 seconds. A draft profile cannot be selected.

- [ ] **Step 2: Implement local storage repository**

Store profiles under one namespaced key, preserve API keys locally, and return redacted copies from `exportRedacted()`. Never log serialized profiles.

- [ ] **Step 3: Add exact presets**

Presets must include OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Zhipu, Doubao, MiniMax, and Ollama with editable endpoints/models and no embedded keys.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/ai/profile-selector.test.ts tests/unit/ai/profile-repository.test.ts`  
Expected: verified capability selection and redaction tests PASS.

```bash
git add src/ai/profiles tests/unit/ai/profile-*.test.ts
git commit -m "feat: 实现模型配置档案"
```

### Task 3: Build the sanitized HTTP client and per-profile limiter

**Files:**
- Create: `src/ai/network/errors.ts`
- Create: `src/ai/network/http-client.ts`
- Create: `src/ai/network/profile-limiter.ts`
- Create: `src/ai/network/request-metrics.ts`
- Create: `src/ai/network/usage-repository.ts`
- Test: `tests/unit/ai/http-client.test.ts`
- Test: `tests/unit/ai/profile-limiter.test.ts`

**Interfaces:**
- Produces: `postProviderJson<T>`, `ProviderError`, `ProfileLimiter.schedule`, `RequestMetric`.

- [ ] **Step 1: Write failure classification tests**

```ts
it.each([
  [401, 'authentication'], [403, 'authorization'], [429, 'rate-limit'], [500, 'provider']
])('maps HTTP %i to %s', async (status, kind) => {
  fetchMock.mockResolvedValue(new Response('{}', { status }));
  await expect(postProviderJson(request)).rejects.toMatchObject({ kind });
});
```

- [ ] **Step 2: Implement request sanitization**

Do not include request bodies, API keys, complete endpoints with query strings, or provider response text in error messages. Record only provider ID, model, task type, status, latency, token metrics, and sanitized error kind. Store at most 1,000 rows or 90 days in `aiUsageLog`, removing the oldest rows first.

- [ ] **Step 3: Implement adaptive scheduling**

Start with concurrency 2 per profile. Respect `Retry-After`; retry network/429/5xx at most twice using bounded exponential backoff. Do not retry authentication, validation, abort, or unknown-result errors.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/ai/http-client.test.ts tests/unit/ai/profile-limiter.test.ts`  
Expected: retry counts, aborts, and redacted errors PASS.

```bash
git add src/ai/network tests/unit/ai/http-client.test.ts tests/unit/ai/profile-limiter.test.ts
git commit -m "feat: 实现模型请求限流与脱敏日志"
```

### Task 4: Implement OpenAI Chat and Responses adapters

**Files:**
- Create: `src/ai/adapters/openai-chat.ts`
- Create: `src/ai/adapters/openai-responses.ts`
- Create: `src/ai/adapters/openai-common.ts`
- Test: `tests/unit/ai/openai-chat.test.ts`
- Test: `tests/unit/ai/openai-responses.test.ts`
- Fixture: `tests/fixtures/ai/openai-chat-success.json`
- Fixture: `tests/fixtures/ai/openai-responses-success.json`

**Interfaces:**
- Consumes: `AiAdapter`, `postProviderJson`, `analysisResultSchema`.
- Produces: `OpenAiChatAdapter`, `OpenAiResponsesAdapter`.

- [ ] **Step 1: Write request-shape and response-shape tests**

Assert Chat calls `<endpoint>/chat/completions` with bearer auth and messages. Assert Responses calls `<endpoint>/responses` with bearer auth and structured text format. Both must return the same `AiAnalysisResult`.

- [ ] **Step 2: Implement shared endpoint normalization**

Strip duplicate trailing slashes, append exactly one API path, and preserve explicitly configured version roots. Never convert Responses payloads into Chat payloads.

- [ ] **Step 3: Implement strict result parsing**

Extract only the provider's documented text output field, parse JSON, run `analysisResultSchema`, then invoke the one-shot repair parser only for syntactically invalid JSON. Schema violations do not get silently coerced.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/ai/openai-chat.test.ts tests/unit/ai/openai-responses.test.ts`  
Expected: exact request snapshots and fixture parsing PASS.

```bash
git add src/ai/adapters/openai* tests/unit/ai/openai* tests/fixtures/ai/openai*
git commit -m "feat: 支持 OpenAI Chat 与 Responses 协议"
```

### Task 5: Implement Anthropic and Gemini adapters

**Files:**
- Create: `src/ai/adapters/anthropic-messages.ts`
- Create: `src/ai/adapters/gemini-generate-content.ts`
- Test: `tests/unit/ai/anthropic-messages.test.ts`
- Test: `tests/unit/ai/gemini-generate-content.test.ts`
- Fixture: `tests/fixtures/ai/anthropic-success.json`
- Fixture: `tests/fixtures/ai/gemini-success.json`

**Interfaces:**
- Produces: `AnthropicMessagesAdapter`, `GeminiGenerateContentAdapter`.

- [ ] **Step 1: Write exact header and payload tests**

Anthropic uses `x-api-key`, `anthropic-version`, `max_tokens`, `system`, and `messages`. Gemini uses the model path ending in `:generateContent`, API-key authentication, `systemInstruction`, and `contents`.

- [ ] **Step 2: Implement capability probes**

Each adapter sends a minimal request containing no bookmark data and reports authentication, text, structured-output, and optional embedding capability separately.

- [ ] **Step 3: Implement response extraction and Schema validation**

Use fixture-driven parsing for text blocks and candidates. Empty, blocked, truncated, or safety-filtered responses return typed provider errors.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- tests/unit/ai/anthropic-messages.test.ts tests/unit/ai/gemini-generate-content.test.ts`  
Expected: request and response fixture tests PASS.

```bash
git add src/ai/adapters/anthropic* src/ai/adapters/gemini* tests/unit/ai/anthropic* tests/unit/ai/gemini* tests/fixtures/ai
git commit -m "feat: 支持 Claude 与 Gemini 协议"
```

### Task 6: Add content redaction and local rule evaluation

**Files:**
- Create: `src/ai/security/redact-sensitive.ts`
- Create: `src/ai/security/untrusted-content.ts`
- Create: `src/rules/types.ts`
- Create: `src/rules/rule-schema.ts`
- Create: `src/rules/rule-engine.ts`
- Test: `tests/unit/ai/redact-sensitive.test.ts`
- Test: `tests/unit/rules/rule-engine.test.ts`

**Interfaces:**
- Produces: `redactSensitiveText`, `wrapUntrustedContent`, `Rule`, `RuleEngine.evaluate`.

- [ ] **Step 1: Write redaction tests**

```ts
it('redacts secrets without storing the original match', () => {
  expect(redactSensitiveText('key=sk-example12345678901234567890')).toBe('key=[REDACTED_API_KEY]');
});
```

Cover email, phone, JWT, bearer token, password field, common provider key prefixes, false positives, and deterministic replacement.

- [ ] **Step 2: Define deterministic rules**

Rules match normalized domain, URL prefix, title keyword, or source folder ID and produce one of `move`, `tag`, `skip-ai`, or `send-to-inbox`. Sort by explicit priority, then creation time. First terminal action wins; tag actions accumulate.

- [ ] **Step 3: Verify and commit**

Run: `pnpm test -- tests/unit/ai/redact-sensitive.test.ts tests/unit/rules/rule-engine.test.ts`  
Expected: redaction and rule precedence tests PASS.

```bash
git add src/ai/security src/rules tests/unit/ai/redact-sensitive.test.ts tests/unit/rules
git commit -m "feat: 加入敏感信息脱敏与本地规则"
```

### Task 7: Build analysis proposals and durable AI task handlers

**Files:**
- Create: `src/ai/analysis-coordinator.ts`
- Create: `src/ai/proposal.ts`
- Create: `src/ai/adapter-registry.ts`
- Create: `src/tasks/handlers/analyze-bookmark.ts`
- Modify: `entrypoints/background.ts`
- Test: `tests/unit/ai/analysis-coordinator.test.ts`
- Test: `tests/integration/ai-task-handler.test.ts`

**Interfaces:**
- Consumes: rule engine, adapter registry, task runner, metadata repository.
- Produces: `AnalysisProposal`, `AnalysisCoordinator.analyze`, `registerAiTaskHandlers`.

- [ ] **Step 1: Define proposal states and write behavior tests**

```ts
export interface AnalysisProposal {
  id: string;
  bookmarkId: BookmarkId;
  sourceSnapshot: BookmarkNode;
  result: AiAnalysisResult;
  state: 'pending' | 'auto-approved' | 'approved' | 'rejected' | 'conflict' | 'failed';
  createdAt: number;
}
```

Test rule-only proposals, model proposals, high-confidence auto approval, low-confidence review, source conflicts, invalid Schema, cancellation, and unknown request result.

- [ ] **Step 2: Implement adapter registry and coordinator**

The coordinator never calls `BookmarkRepository.move` or `update`. It writes proposals and returns their ID. Auto-approved proposals are still applied by the operation command service so they remain undoable.

- [ ] **Step 3: Register durable handlers**

The `analyze-bookmark` handler locks the profile version, emits progress, and clears in-memory page text in a `finally` block. Unknown network outcomes mark the task and proposal `unknown`/`failed` without automatic replay.

- [ ] **Step 4: Verify and pass Gate 2**

Run: `pnpm typecheck && pnpm lint && pnpm test -- tests/unit/ai tests/unit/rules tests/integration/ai-task-handler.test.ts && pnpm build`  
Expected: all four adapters and proposal workflows PASS without network access.

- [ ] **Step 5: Commit**

```bash
git add src/ai src/tasks/handlers entrypoints/background.ts tests/unit/ai tests/integration/ai-task-handler.test.ts
git commit -m "feat: 实现 AI 分析与审核提案管线"
```

Update Gate 2 in the master plan and commit `docs: 记录 AI 阶段验收结果`.
