/**
 * Thin fetch wrapper around the Cite42 public REST API.
 *
 * Credentials come from EITHER a CLI flag or an env var, so users can configure the server in
 * whichever form their MCP client makes easiest:
 *   - flag: `npx @cite42/mcp --api-key=cite42_live_... [--api-base=...]`  (Stripe-style; one flat
 *           line in the client's `args`)
 *   - env:  `CITE42_API_KEY` / `CITE42_API_BASE`  (set in the client config's `env` block)
 * The flag wins when both are present. Most code clients (Cursor, Claude Code, VS Code) take the
 * arg form; the env form still works everywhere.
 */

const DEFAULT_BASE_URL = 'https://www.cite42.dev/api/v1';
/** Same wording as the hosted server's FUNDS_LOCATION: the dashboard home, not the checkout page. */
const FUNDS_LOCATION = 'the Cite42 dashboard at https://www.cite42.dev/app';

/** Fixed ledger conversion, matching the hosted API's five-decimal USD precision. */
export function toUsd(micro: number): string {
  const [whole, fraction = ''] = (micro / 100_000).toFixed(5).split('.');
  return `${whole}.${fraction.slice(0, Math.max(2, fraction.replace(/0+$/, '').length))}`;
}

export function toCite42Balance(micro: number) {
  return {
    cite42Billing: {
      currency: 'USD' as const,
      remainingUsd: toUsd(micro),
      message: `Cite42 balance: $${toUsd(micro)} USD remaining. This balance check was free.`,
    },
  };
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A tracker's commitment block, as opposed to a metered call's billing block.
 *
 * Two different things arrive under `billing`: what one call just cost, and whether a recurring
 * schedule is funded. This one carries USD and ledger units, and every tracker
 * tool tells the agent to relay it, so it must survive.
 */
function isTrackerCommitment(billing: Record<string, unknown>): boolean {
  return (
    typeof billing.balanceMicro === 'number' && typeof billing.costMicroPerRun === 'number'
  );
}

/**
 * The public REST API returns USD alongside its ledger units. MCP clients receive only a clearly
 * branded USD summary, so a host never presents Cite42 funds as its own (for example, a Claude or
 * model-provider balance) and a model has no retired credit units to quote back.
 */
export function toCite42McpResult(value: unknown): unknown {
  if (!isJsonObject(value)) return value;

  const { billing, warning, ...result } = value;
  if (!isJsonObject(billing)) return value;

  // Tracker activation carries runsDryAt and coversNextRun — the only place an agent can learn
  // whether a schedule it just started is actually funded. Dropping it as an unrecognized billing
  // block left the tool promising numbers the client never received.
  if (isTrackerCommitment(billing)) return { ...result, billing };

  const cost = isJsonObject(billing.cost) ? billing.cost.microCredits : undefined;
  const balance = isJsonObject(billing.balance) ? billing.balance.microCredits : undefined;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || typeof balance !== 'number' || !Number.isFinite(balance)) {
    // Never pass an unbranded REST billing block through an MCP result, even if it is malformed.
    return result;
  }

  const originalCost = isJsonObject(billing.originalCost) ? billing.originalCost.microCredits : undefined;
  const replay = typeof result.replayOf === 'string' && typeof originalCost === 'number' && Number.isFinite(originalCost);
  const lowBalanceNotice = typeof warning === 'string' ? ' Low Cite42 balance.' : '';
  const cite42Billing = {
    currency: 'USD' as const,
    chargedUsd: toUsd(cost),
    remainingUsd: toUsd(balance),
    ...(replay ? { originalChargedUsd: toUsd(originalCost) } : {}),
    message: (replay
      ? `Replay of an identical request from the last 2 minutes. This attempt was free; ` +
        `$${toUsd(originalCost)} USD was charged once, by the original Cite42 call.`
      : `Cite42: $${toUsd(cost)} USD charged; $${toUsd(balance)} USD remaining.`) + lowBalanceNotice,
  };

  return { ...result, cite42Billing };
}

function errorMessageForMcp(status: number, path: string, body: string): string {
  try {
    const payload: unknown = JSON.parse(body);
    if (isJsonObject(payload) && isJsonObject(payload.error) && typeof payload.error.code === 'string') {
      if (payload.error.code === 'daily_limit_exceeded' || payload.error.code === 'monthly_limit_exceeded') {
        return `Cite42 spending limit reached. Change it in ${FUNDS_LOCATION}.`;
      }
      if (payload.error.code === 'insufficient_credits') {
        return `Insufficient Cite42 balance. Add funds in ${FUNDS_LOCATION}.`;
      }
    }
  } catch {
    // Fall through to the API response below; its text is useful for validation failures.
  }
  return `Cite42 API ${status} ${path}: ${body}`;
}

/** Read a `--name=value` (or `--name value`) flag from argv, or undefined if absent. */
function readFlag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}` && i + 1 < argv.length) return argv[i + 1];
  }
  return undefined;
}

/** The configured API key from the `--api-key` flag or `CITE42_API_KEY`, or undefined if absent. */
export function resolveApiKey(): string | undefined {
  return readFlag('api-key') ?? process.env.CITE42_API_KEY;
}

function getApiKey(): string {
  const key = resolveApiKey();
  if (!key) {
    throw new Error(
      'No Cite42 API key found. Pass --api-key=cite42_live_... in the server args, or set the ' +
        'CITE42_API_KEY environment variable in your MCP client config.'
    );
  }
  return key;
}

function getBaseUrl(): string {
  return readFlag('api-base') ?? process.env.CITE42_API_BASE ?? DEFAULT_BASE_URL;
}

export async function aivPost<T = unknown>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return aivWrite<T>('POST', path, body, signal);
}

export async function aivPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  return aivWrite<T>('PATCH', path, body);
}

export async function aivDelete<T = unknown>(path: string): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(errorMessageForMcp(res.status, path, body));
  }

  return toCite42McpResult(await res.json()) as T;
}

async function aivWrite<T>(method: 'POST' | 'PATCH', path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const url = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(errorMessageForMcp(res.status, path, text));
  }

  return toCite42McpResult(await res.json()) as T;
}

export async function aivGet<T = unknown>(path: string): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(errorMessageForMcp(res.status, path, text));
  }

  return toCite42McpResult(await res.json()) as T;
}
