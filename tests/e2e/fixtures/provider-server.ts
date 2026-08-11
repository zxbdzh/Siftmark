import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';

const host = '127.0.0.1';
const port = 43_173;
interface RecordedRequest {
  method: string;
  path: string;
  headerNames: string[];
  body: unknown;
}
interface ProviderBehavior {
  delayAnalysisMs: number;
  failAnalysisCount: number;
  invalidAnalysisCount: number;
}

const requests: RecordedRequest[] = [];
const behavior: ProviderBehavior = {
  delayAnalysisMs: 0,
  failAnalysisCount: 0,
  invalidAnalysisCount: 0
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (request.method === 'OPTIONS') return text(response, 204, '');
  if (url.pathname === '/__e2e/requests') return json(response, 200, requests);
  if (url.pathname === '/__e2e/reset' && request.method === 'POST') {
    requests.length = 0;
    Object.assign(behavior, {
      delayAnalysisMs: 0,
      failAnalysisCount: 0,
      invalidAnalysisCount: 0
    });
    return json(response, 200, { ok: true });
  }
  if (url.pathname === '/__e2e/behavior' && request.method === 'POST') {
    Object.assign(behavior, await readJsonBody(request));
    return json(response, 200, behavior);
  }
  if (url.pathname === '/health') return json(response, 200, { ok: true });
  if (url.pathname === '/article') {
    return html(
      response,
      '<title>Siftmark 本地文章</title><main><h1>Siftmark 本地文章</h1><p>这是用于端到端测试的确定性正文。</p></main>'
    );
  }
  if (url.pathname === '/login') {
    return html(
      response,
      '<title>需要登录</title><main><h1>需要登录</h1><form><input type="password"></form></main>'
    );
  }
  if (url.pathname === '/fixture/fail-once') {
    const failed = request.headers['x-siftmark-retry'] !== '1';
    return json(
      response,
      failed ? 503 : 200,
      failed ? { error: 'fixture failure' } : analysis()
    );
  }
  if (url.pathname.endsWith('/chat/completions')) {
    const result = await providerPayload(request, url);
    if (result.status !== 200)
      return json(response, result.status, { error: 'fixture failure' });
    return json(response, 200, {
      choices: [{ message: { content: JSON.stringify(result.payload) } }]
    });
  }
  if (url.pathname.endsWith('/responses')) {
    const result = await providerPayload(request, url);
    if (result.status !== 200)
      return json(response, result.status, { error: 'fixture failure' });
    return json(response, 200, {
      output: [
        ...(result.webSearchRequested
          ? [{ type: 'web_search_call', status: 'completed' }]
          : []),
        {
          type: 'message',
          content: [
            { type: 'output_text', text: JSON.stringify(result.payload) }
          ]
        }
      ]
    });
  }
  if (url.pathname.endsWith('/messages')) {
    const result = await providerPayload(request, url);
    if (result.status !== 200)
      return json(response, result.status, { error: 'fixture failure' });
    return json(response, 200, {
      content: [{ type: 'text', text: JSON.stringify(result.payload) }]
    });
  }
  if (url.pathname.includes(':generateContent')) {
    const result = await providerPayload(request, url);
    if (result.status !== 200)
      return json(response, result.status, { error: 'fixture failure' });
    return json(response, 200, {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [{ text: JSON.stringify(result.payload) }]
          }
        }
      ]
    });
  }
  if (url.pathname.endsWith('/embeddings')) {
    const body = await recordRequest(request, url);
    const input =
      isRecord(body) && Array.isArray(body.input) ? body.input : [''];
    return json(response, 200, {
      data: input.map((_, index) => ({ embedding: [1, 0], index }))
    });
  }
  if (url.pathname.includes(':batchEmbedContents')) {
    await recordRequest(request, url);
    return json(response, 200, { embeddings: [{ values: [1, 0] }] });
  }
  if (url.pathname === '/health/dead') return text(response, 404, 'missing');
  if (url.pathname === '/health/temporary') return text(response, 503, 'retry');
  return text(response, 404, 'not found');
});

server.listen(port, host);

function analysis() {
  return {
    folderPath: ['测试'],
    title: '本地模型建议标题',
    tags: ['端到端'],
    summary: '本地夹具摘要',
    confidence: 'medium',
    reason: '固定响应'
  };
}

async function providerPayload(request: IncomingMessage, url: URL) {
  const body = await recordRequest(request, url);
  const serialized = JSON.stringify(body);
  const webSearchRequested = hasWebSearchTool(body);
  const analysisProbe = serialized.includes('siftmark_analysis_probe');
  const legacyProbe =
    serialized.includes('siftmark_probe') ||
    serialized.includes('"required":["ok"]') ||
    serialized.includes('"max_tokens":32');
  const probe = analysisProbe || legacyProbe;
  if (!probe && behavior.failAnalysisCount > 0) {
    behavior.failAnalysisCount -= 1;
    return { status: 503, payload: null, webSearchRequested };
  }
  if (!probe && behavior.delayAnalysisMs > 0)
    await new Promise((resolve) =>
      setTimeout(resolve, behavior.delayAnalysisMs)
    );
  if (!probe && behavior.invalidAnalysisCount > 0) {
    behavior.invalidAnalysisCount -= 1;
    return {
      status: 200,
      payload: { ...analysis(), url: 'https://schema-must-reject.test/' },
      webSearchRequested
    };
  }
  return {
    status: 200,
    payload: legacyProbe && !analysisProbe ? { ok: true } : analysis(),
    webSearchRequested
  };
}

function hasWebSearchTool(body: unknown): boolean {
  if (!isRecord(body) || !Array.isArray(body.tools)) return false;
  return body.tools.some(
    (tool) => isRecord(tool) && tool.type === 'web_search'
  );
}

async function recordRequest(request: IncomingMessage, url: URL) {
  const body = await readJsonBody(request);
  requests.push({
    method: request.method ?? 'GET',
    path: url.pathname,
    headerNames: Object.keys(request.headers).sort(),
    body
  });
  return body;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders()
  });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    ...corsHeaders()
  });
  response.end(body);
}

function text(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...corsHeaders()
  });
  response.end(body);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-allow-private-network': 'true'
  };
}

function close() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
