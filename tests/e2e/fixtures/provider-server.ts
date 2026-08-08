import { createServer, type ServerResponse } from 'node:http';

const host = '127.0.0.1';
const port = 4173;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
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
    return json(response, 200, {
      choices: [{ message: { content: JSON.stringify(analysis()) } }]
    });
  }
  if (url.pathname.endsWith('/responses')) {
    return json(response, 200, {
      output: [
        { content: [{ type: 'output_text', text: JSON.stringify(analysis()) }] }
      ]
    });
  }
  if (url.pathname.endsWith('/messages')) {
    return json(response, 200, {
      content: [{ type: 'text', text: JSON.stringify(analysis()) }]
    });
  }
  if (url.pathname.includes(':generateContent')) {
    return json(response, 200, {
      candidates: [
        { content: { parts: [{ text: JSON.stringify(analysis()) }] } }
      ]
    });
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
    confidence: 'high',
    reason: '固定响应'
  };
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*'
  });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function text(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function close() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
