/**
 * Protocol tests: drive the same server Claude Desktop runs, over an in-memory transport with
 * the official MCP client — the full initialize → tools/list → tools/call path, minus the pipe.
 * The Cite42 REST API is always mocked; nothing here can bill or call a vendor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildCite42Server, CITE42_TOOLS } from './server.js';

const fetchMock = vi.fn();

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
}

/** Tool results arrive as JSON text content; some SDK paths add structuredContent too. */
function parseToolResult(result: ToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function connectedClient(): Promise<Client> {
  const server = buildCite42Server('0.0.0-test');
  const client = new Client({ name: 'vitest-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.getServer().connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function restResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CITE42_API_KEY', 'cite42_live_test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const workflowCases = [
  { tool: 'cite42_find_content_opportunities', path: 'content-opportunities', input: { topic: 'CRM software' } },
  { tool: 'cite42_analyze_topic_demand', path: 'topic-demand', input: { topic: 'CRM software' } },
  { tool: 'cite42_map_ai_prompts', path: 'ai-prompt-map', input: { topic: 'CRM software' } },
  { tool: 'cite42_analyze_competitor_content', path: 'competitor-content', input: { competitors: ['Salesforce', 'HubSpot'] } },
  { tool: 'cite42_find_ai_citation_gaps', path: 'ai-citation-gaps', input: { query: 'best CRM', brand: 'Salesforce' } },
  { tool: 'cite42_generate_content_brief', path: 'content-brief', input: { topic: 'CRM software' } },
];

describe('workflow model selection', () => {
  it('offers model selection on every workflow', async () => {
    const client = await connectedClient();
    try {
      const { tools } = await client.listTools();
      for (const name of workflowCases.map((workflow) => workflow.tool)) {
        const schema = tools.find((tool) => tool.name === name)?.inputSchema;
        expect(schema?.properties, name).toHaveProperty('models');
        expect(schema?.properties, name).toHaveProperty('fullSweep');
      }
    } finally {
      await client.close();
    }
  });

  it.each(workflowCases.flatMap((workflow) => [
    { ...workflow, selection: { models: ['gemini'] }, mode: 'one model' },
    { ...workflow, selection: { fullSweep: true }, mode: 'full sweep' },
  ]))('forwards $mode unchanged for $tool', async ({ tool, path, input, selection }) => {
    fetchMock.mockResolvedValue(restResponse({ status: 'workflow_result' }));
    const client = await connectedClient();
    try {
      const result = await client.callTool({ name: tool, arguments: { ...input, ...selection } });
      expect(result.isError ?? false).toBe(false);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://www.cite42.dev/api/v1/workflows/${path}`);
      expect(JSON.parse(init.body as string)).toEqual({ ...input, ...selection });
    } finally {
      await client.close();
    }
  });
});

describe('tools/list', () => {
  it('points the prompt map and the tracker at each other', async () => {
    // An agent only chains these two if the descriptions say they connect: map_ai_prompts returns
    // prompts and tracker_create consumes them, and nothing else in the protocol conveys that.
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const description = (name: string) =>
      tools.find((tool) => tool.name === name)?.description ?? '';

    expect(description('cite42_map_ai_prompts')).toContain('cite42_tracker_create');
    expect(description('cite42_tracker_create')).toContain('cite42_map_ai_prompts');
  });

  it('exposes exactly the published Cite42 tool registry with descriptions and schemas', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(CITE42_TOOLS).sort());
    const mutationTools = new Set([
      'cite42_tracker_create',
      'cite42_tracker_update',
      'cite42_tracker_activate',
      'cite42_tracker_pause',
      'cite42_tracker_delete',
      'cite42_tracker_run',
    ]);
    for (const tool of tools) {
      expect(tool.description ?? '').not.toBe('');
      expect(tool.inputSchema).toBeDefined();
      // Directory review rejects any tool missing a title or safety hint. This also pins Mastra's
      // `mcp.annotations` pass-through: a Mastra upgrade that stopped forwarding it would
      // otherwise drop every annotation silently.
      expect(tool.annotations?.title ?? '').not.toBe('');
      expect(tool.annotations?.readOnlyHint).toBe(!mutationTools.has(tool.name));
      if (mutationTools.has(tool.name)) {
        expect(tool.annotations?.destructiveHint).toBe(
          tool.name === 'cite42_tracker_update' || tool.name === 'cite42_tracker_delete'
        );
      } else {
        expect(tool.annotations?.destructiveHint).toBe(false);
      }
    }
  });
});

describe('tools/call — REST forwarding', () => {

  it('forwards saved-result recommendations and preserves request IDs, metrics and exact billing', async () => {
    const metrics = [{ evidenceId: 'saved-result', values: { checkedAnswers: 3 } }];
    fetchMock.mockResolvedValue(restResponse({ requestId: 'recommendation-result', status: 'complete', source: 'ai',
      recommendations: [{ id: 'finding-1', suggestion: { kind: 'inferred', text: 'Draft a setup guide. Check: Verify each step.' } }],
      metrics, billing: { cost: { microCredits: 3_000, usd: '0.03' }, balance: { microCredits: 97_000, usd: '0.97' } } }));
    const client = await connectedClient();
    const input = { requestId: 'saved-result', context: { brand: 'Acme', goal: 'Improve onboarding' } };
    const result = await client.callTool({ name: 'cite42_recommendations', arguments: input }) as ToolResult;
    expect(result.isError ?? false).toBe(false);
    expect(parseToolResult(result)).toMatchObject({ requestId: 'recommendation-result', status: 'complete', metrics,
      cite42Billing: { chargedUsd: '0.03', remainingUsd: '0.97' } });
    expect(parseToolResult(result)).not.toHaveProperty('billing');
    expect(parseToolResult(result)).not.toHaveProperty('cite42Credits');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/recommendations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
    await client.close();
  });

  it('returns USD balances and requests USD pricing even when an older client passes currency', async () => {
    fetchMock.mockResolvedValueOnce(restResponse({ balance: { microCredits: 123_001 } }))
      .mockResolvedValueOnce(restResponse({ currency: 'USD', flatEndpoints: {} }));
    const client = await connectedClient();
    const balance = await client.callTool({ name: 'cite42_balance', arguments: {} }) as ToolResult;
    expect(parseToolResult(balance)).toMatchObject({
      cite42Billing: { currency: 'USD', remainingUsd: '1.23001' },
    });
    const prices = await client.callTool({ name: 'cite42_pricing', arguments: { currency: 'USD' } }) as ToolResult;
    expect(parseToolResult(prices)).toMatchObject({ currency: 'USD' });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://www.cite42.dev/api/v1/pricing?currency=USD');
  });

  it('returns only the USD price table for calls without arguments', async () => {
    fetchMock.mockResolvedValueOnce(restResponse({ currency: 'USD', flatEndpoints: { example: { usd: '0.22' } } }));
    const client = await connectedClient();
    const result = await client.callTool({ name: 'cite42_pricing', arguments: {} }) as ToolResult;
    expect(parseToolResult(result)).toEqual({ currency: 'USD', flatEndpoints: { example: { usd: '0.22' } } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://www.cite42.dev/api/v1/pricing?currency=USD');
  });

  it('forwards a keyword batch as one REST request', async () => {
    fetchMock.mockResolvedValue(restResponse({
      results: [{ keyword: 'ai visibility tracking', status: 'exact', volume: 480 }],
      billing: {
        cost: { microCredits: 9_000, usd: '0.09' },
        balance: { microCredits: 100_000, usd: '1.00' },
      },
    }));

    const client = await connectedClient();
    const result = (await client.callTool({
      name: 'cite42_keywords_batch',
      arguments: { seeds: ['ai visibility tracking', 'ai sentiment tracking'] },
    })) as ToolResult;

    expect(result.isError ?? false).toBe(false);
    expect(parseToolResult(result)).toMatchObject({ cite42Billing: { chargedUsd: '0.09' } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/keywords/batch');
    expect(JSON.parse(init.body as string)).toEqual({
      seeds: ['ai visibility tracking', 'ai sentiment tracking'],
    });
  });

  it('forwards cite42_search to POST /v1/search with the bearer key and rebrands billing', async () => {
    fetchMock.mockResolvedValue(
      restResponse({
        query: 'best crm',
        answers: [{ model: 'claude', text: 'CRM answer' }],
        billing: {
          cost: { microCredits: 22_000, usd: '0.22' },
          balance: { microCredits: 1_000_000, usd: '10.00' },
        },
      })
    );

    const client = await connectedClient();
    const result = (await client.callTool({
      name: 'cite42_search',
      arguments: { query: 'best crm', models: ['claude'] },
    })) as ToolResult;

    expect(result.isError ?? false).toBe(false);
    const body = parseToolResult(result) as Record<string, unknown>;

    // The REST billing block must never pass through an MCP surface unbranded.
    expect(body.billing).toBeUndefined();
    expect(body.cite42Billing).toMatchObject({ chargedUsd: '0.22', remainingUsd: '10.00' });
    expect(body.cite42Credits).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/search');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer cite42_live_test');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'best crm', models: ['claude'] });
  });

  it('serves the legacy cite42_credits alias from GET /v1/usage in USD only', async () => {
    fetchMock.mockResolvedValue(restResponse({ balance: { microCredits: 123_000 } }));

    const client = await connectedClient();
    const result = (await client.callTool({ name: 'cite42_credits', arguments: {} })) as ToolResult;

    expect(result.isError ?? false).toBe(false);
    expect(parseToolResult(result)).toEqual({
      cite42Billing: {
        currency: 'USD', remainingUsd: '1.23',
        message: 'Cite42 balance: $1.23 USD remaining. This balance check was free.',
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/usage');
    expect(init.method).toBe('GET');
  });

  it('forwards a tracker draft to the free tracker lifecycle endpoint', async () => {
    fetchMock.mockResolvedValue(
      restResponse({ tracker: { id: 'tracker_1', status: 'DRAFT' } })
    );

    const client = await connectedClient();
    const result = (await client.callTool({
      name: 'cite42_tracker_create',
      arguments: {
        name: 'Weekly visibility',
        cadence: {
          frequency: 'weekly',
          timezone: 'Europe/London',
          time: '09:00',
          weekday: 1,
        },
        primitive: 'rankings',
        competitors: ['Acme', 'Northstar'],
        models: ['chatgpt'],
        prompts: ['best CRM for startups', 'best CRM for a two person team'],
      },
    })) as ToolResult;

    expect(result.isError ?? false).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/trackers');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: 'Weekly visibility',
      primitive: 'rankings',
      prompts: ['best CRM for startups', 'best CRM for a two person team'],
      competitors: ['Acme', 'Northstar'],
    });
  });

  it('forwards permanent tracker deletion to DELETE without a body', async () => {
    fetchMock.mockResolvedValue(
      restResponse({ deleted: true, trackerId: 'tracker_1' })
    );

    const client = await connectedClient();
    const result = (await client.callTool({
      name: 'cite42_tracker_delete',
      arguments: { trackerId: 'tracker_1' },
    })) as ToolResult;

    expect(result.isError ?? false).toBe(false);
    expect(parseToolResult(result)).toEqual({ deleted: true, trackerId: 'tracker_1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/trackers/tracker_1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('rejects invalid arguments before any REST call is made', async () => {
    const client = await connectedClient();

    const outcome = await client
      .callTool({ name: 'cite42_search', arguments: { query: '' } })
      .then((result) => result as ToolResult)
      .catch((error: unknown) => error);

    // Depending on the SDK path this surfaces as a protocol error or an isError result —
    // either way the invalid input must never reach the paid REST API.
    if (outcome instanceof Error) {
      expect(outcome.message).toBeTruthy();
    } else {
      expect((outcome as ToolResult).isError).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps legacy insufficient_credits errors to an actionable balance message', async () => {
    fetchMock.mockResolvedValue(
      restResponse({ error: { code: 'insufficient_credits', message: 'nope' } }, 402)
    );

    const client = await connectedClient();
    const result = (await client.callTool({
      name: 'cite42_search',
      arguments: { query: 'best crm' },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Add funds in the Cite42 dashboard at https://www.cite42.dev/app');
    expect(result.content?.[0]?.text).not.toMatch(/\bcredits?\b/i);
  });
});
