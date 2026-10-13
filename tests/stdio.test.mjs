import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const executable = fileURLToPath(new URL('../dist/stdio.mjs', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const fakeKey = 'cite42_live_stdio_test_only';

test('built executable initializes, discovers tools, forwards credentials, and surfaces revocation', { timeout: 20_000 }, async (t) => {
  const requests = [];
  let revoked = false;
  // Only a loopback fake API is reachable through this configuration: no real keys or providers.
  const api = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'GET' || req.url !== '/api/v1/usage') {
      res.writeHead(404).end(JSON.stringify({ error: 'Unexpected endpoint' }));
    } else if (revoked || req.headers.authorization !== `Bearer ${fakeKey}`) {
      res.writeHead(401).end(JSON.stringify({ error: { code: 'invalid_api_key' } }));
    } else {
      res.end(JSON.stringify({ balance: { microCredits: 123_000 } }));
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    api.closeAllConnections();
    api.close((error) => error ? reject(error) : resolve());
  }));
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable],
    env: {
      ...getDefaultEnvironment(),
      CITE42_API_KEY: fakeKey,
      CITE42_API_BASE: `http://127.0.0.1:${api.address().port}/api/v1`,
    },
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  const client = new Client({ name: 'cite42-stdio-smoke', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, version);

  const { tools } = await client.listTools();
  for (const name of ['cite42_balance', 'cite42_credits', 'cite42_search', 'cite42_recommendations', 'cite42_tracker_create']) {
    assert.ok(tools.some((tool) => tool.name === name), `Missing ${name}`);
  }
  for (const tool of tools) {
    assert.ok(tool.description, `Missing description: ${tool.name}`);
    assert.equal(tool.inputSchema.type, 'object');
  }
  assert.equal(requests.length, 0, 'Discovery must not call the REST API');

  const balance = await client.callTool({ name: 'cite42_credits', arguments: {} });
  assert.notEqual(balance.isError, true);
  const payload = balance.structuredContent ?? JSON.parse(balance.content.find((item) => item.type === 'text').text);
  // The legacy alias answers in USD only, exactly like cite42_balance.
  assert.equal(payload.cite42Credits, undefined);
  assert.equal(payload.cite42Billing.remainingUsd, '1.23');
  const usdBalance = await client.callTool({ name: 'cite42_balance', arguments: {} });
  const usdPayload = JSON.parse(usdBalance.content[0].text);
  assert.equal(usdPayload.cite42Billing.currency, 'USD');
  assert.equal(usdPayload.cite42Billing.remainingUsd, '1.23');
  assert.equal(usdPayload.cite42Credits, undefined);
  assert.deepEqual(requests, Array.from({ length: 2 }, () => ({
    method: 'GET', url: '/api/v1/usage', authorization: `Bearer ${fakeKey}`,
  })));

  revoked = true;
  const denied = await client.callTool({ name: 'cite42_credits', arguments: {} });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied.content), /401/);
  assert.equal(requests.length, 3);
  assert.ok((await client.listTools()).tools.length > 0, 'Auth errors must not kill the server');
});

test('built executable exits cleanly when no API key is supplied', () => {
  const result = spawnSync(process.execPath, [executable], {
    env: getDefaultEnvironment(),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '', 'Startup diagnostics must not corrupt the MCP stdout stream');
  assert.match(result.stderr, /Missing API key/);
});


test('MCP cancellation aborts the forwarded Reddit HTTP request', { timeout: 10_000 }, async (t) => {
  let received;
  let disconnected;
  const requestSeen = new Promise(resolve => { received = resolve; });
  const connectionClosed = new Promise(resolve => { disconnected = resolve; });
  const api = createServer((req, res) => {
    req.resume();
    res.on('close', disconnected);
    received();
    // Deliberately never answer: the MCP cancellation must close this upstream request.
  });
  t.after(() => new Promise(resolve => { api.closeAllConnections(); api.close(resolve); }));
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const transport = new StdioClientTransport({
    command: process.execPath, args: [executable],
    env: { ...getDefaultEnvironment(), CITE42_API_KEY: fakeKey, CITE42_API_BASE: `http://127.0.0.1:${api.address().port}/api/v1` },
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  const client = new Client({ name: 'cancel-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const controller = new AbortController();
  const call = client.callTool({ name: 'cite42_reddit_trends', arguments: { topic: 'crm' } }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(call);
  await requestSeen;
  controller.abort();
  await rejected;
  await connectionClosed;
});
