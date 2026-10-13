/**
 * The REST client is the entire attack surface between a customer's MCP host and their Cite42
 * balance. Invariants: the bearer key is attached to every call, REST billing blocks are always
 * rebranded (or dropped) before a host sees them, and billing failures map to actionable errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aivDelete,
  aivGet,
  aivPatch,
  aivPost,
  resolveApiKey,
  toCite42McpResult,
  toUsd,
} from './client.js';

const fetchMock = vi.fn();
const originalArgv = [...process.argv];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CITE42_API_KEY', 'cite42_live_test');
  vi.stubEnv('CITE42_API_BASE', '');
  process.env.CITE42_API_BASE = undefined as unknown as string;
  delete process.env.CITE42_API_BASE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.argv = [...originalArgv];
});

function restResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('USD billing', () => {
  it('keeps the original USD charge on a free REST replay instead of reporting a free original call', () => {
    expect(toCite42McpResult({
      replayOf: 'req-1',
      replayNote: 'Identical request — not charged again.',
      billing: {
        cost: { microCredits: 0, usd: '0.00' },
        originalCost: { microCredits: 500, usd: '0.005' },
        balance: { microCredits: 123_001, usd: '1.23001' },
      },
      warning: 'Low balance',
    })).toMatchObject({
      replayOf: 'req-1',
      cite42Billing: {
        currency: 'USD', chargedUsd: '0.00', originalChargedUsd: '0.005', remainingUsd: '1.23001',
        message: 'Replay of an identical request from the last 2 minutes. This attempt was free; ' +
          '$0.005 USD was charged once, by the original Cite42 call. Low Cite42 balance.',
      },
    });
  });

  it.each([[1, '0.00001'], [500, '0.005'], [22_000, '0.22'], [2_500_000, '25.00']])(
    'preserves the exact USD value for %i ledger units', (micro, expected) => {
      expect(toUsd(micro)).toBe(expected);
    }
  );
  it('reports USD only, keeping the low-balance warning', () => {
    expect(toCite42McpResult({
      billing: { cost: { microCredits: 500 }, balance: { microCredits: 123_001 } },
      warning: 'Low balance',
    })).toEqual({
      cite42Billing: {
        currency: 'USD', chargedUsd: '0.005', remainingUsd: '1.23001',
        message: 'Cite42: $0.005 USD charged; $1.23001 USD remaining. Low Cite42 balance.',
      },
    });
  });
});

describe('toCite42McpResult', () => {
  it('replaces the REST billing block with branded Cite42 USD billing', () => {
    const branded = toCite42McpResult({
      answers: ['a'],
      billing: {
        cost: { microCredits: 22_000, usd: '0.22' },
        balance: { microCredits: 1_000_000, usd: '10.00' },
      },
    }) as Record<string, unknown>;

    expect(branded.billing).toBeUndefined();
    expect(branded.answers).toEqual(['a']);
    expect(branded.cite42Billing).toEqual({
      currency: 'USD',
      chargedUsd: '0.22',
      remainingUsd: '10.00',
      message: 'Cite42: $0.22 USD charged; $10.00 USD remaining.',
    });
    // Credits are retired; a model shown both units quotes credits back to the user.
    expect(branded.cite42Credits).toBeUndefined();
  });

  it('drops a malformed billing block instead of passing it through unbranded', () => {
    const branded = toCite42McpResult({
      answers: ['a'],
      billing: { cost: { microCredits: 'NaN-ish' }, balance: {} },
    }) as Record<string, unknown>;

    expect(branded.billing).toBeUndefined();
    expect(branded.cite42Billing).toBeUndefined();
    expect(branded.answers).toEqual(['a']);
  });

  it("keeps a tracker's commitment block, which the tools promise to relay", () => {
    const activated = toCite42McpResult({
      tracker: { id: 'trk_1', status: 'ACTIVE' },
      billing: {
        balanceMicro: 10_000_000,
        costMicroPerRun: 6_000,
        committedDailyBurnMicro: 857.14,
        runsDryAt: '2027-01-01T00:00:00.000Z',
        coversNextRun: true,
        autoTopUp: false,
      },
    }) as Record<string, unknown>;

    // Not the metered shape, so it must not be rebranded as a per-call charge either.
    expect(activated.cite42Billing).toBeUndefined();
    expect(activated.billing).toMatchObject({
      runsDryAt: '2027-01-01T00:00:00.000Z',
      coversNextRun: true,
      costMicroPerRun: 6_000,
    });
  });

  it('passes non-object and billing-free values through untouched', () => {
    expect(toCite42McpResult(42)).toBe(42);
    expect(toCite42McpResult(null)).toBeNull();
    expect(toCite42McpResult({ plain: true })).toEqual({ plain: true });
  });
});

describe('resolveApiKey', () => {
  it('prefers the --api-key flag over the environment', () => {
    process.argv = [...originalArgv.slice(0, 2), '--api-key=cite42_live_flagged'];
    expect(resolveApiKey()).toBe('cite42_live_flagged');
  });

  it('falls back to CITE42_API_KEY', () => {
    expect(resolveApiKey()).toBe('cite42_live_test');
  });
});

describe('aivPost / aivGet', () => {
  it('POSTs to the default base with the bearer key and JSON body', async () => {
    fetchMock.mockResolvedValue(restResponse({ ok: true }));

    await aivPost('/search', { query: 'best crm' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/search');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer cite42_live_test');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'best crm' });
  });

  it('normalizes paths without a leading slash', async () => {
    fetchMock.mockResolvedValue(restResponse({ ok: true }));
    await aivGet('usage');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://www.cite42.dev/api/v1/usage');
  });

  it('PATCHes tracker configuration through the same authenticated client', async () => {
    fetchMock.mockResolvedValue(restResponse({ tracker: { id: 'tracker_1' } }));

    await aivPatch('/trackers/tracker_1', { name: 'Updated tracker' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/trackers/tracker_1');
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer cite42_live_test');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Updated tracker' });
  });

  it('DELETEs a tracker through the same authenticated client without a request body', async () => {
    fetchMock.mockResolvedValue(restResponse({ deleted: true, trackerId: 'tracker_1' }));

    await expect(aivDelete('/trackers/tracker_1')).resolves.toEqual({
      deleted: true,
      trackerId: 'tracker_1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.cite42.dev/api/v1/trackers/tracker_1');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer cite42_live_test');
    expect(init.body).toBeUndefined();
  });

  it('brands billing on successful responses', async () => {
    fetchMock.mockResolvedValue(
      restResponse({
        billing: { cost: { microCredits: 5_000 }, balance: { microCredits: 95_000 } },
      })
    );

    const result = (await aivPost('/search', { query: 'q' })) as Record<string, unknown>;
    expect(result.cite42Billing).toMatchObject({ chargedUsd: '0.05', remainingUsd: '0.95' });
  });

  it('maps the legacy insufficient_credits code to an add-funds instruction', async () => {
    fetchMock.mockResolvedValue(
      restResponse({ error: { code: 'insufficient_credits', message: 'x' } }, 402)
    );
    await expect(aivPost('/search', { query: 'q' })).rejects.toThrow(
      'Insufficient Cite42 balance. Add funds in the Cite42 dashboard at https://www.cite42.dev/app.'
    );
  });

  it('maps spend-limit rejections to the dashboard', async () => {
    fetchMock.mockResolvedValue(
      restResponse({ error: { code: 'daily_limit_exceeded', message: 'x' } }, 429)
    );
    await expect(aivPost('/search', { query: 'q' })).rejects.toThrow(
      'Cite42 spending limit reached. Change it in the Cite42 dashboard at https://www.cite42.dev/app.'
    );
  });

  it('surfaces other API errors with status, path, and body for debugging', async () => {
    fetchMock.mockResolvedValue(
      restResponse({ error: { code: 'invalid_request', message: 'query required' } }, 400)
    );
    await expect(aivPost('/search', {})).rejects.toThrow(/Cite42 API 400 \/search/);
  });
});
