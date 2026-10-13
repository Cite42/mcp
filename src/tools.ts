/**
 * MCP tools for the Cite42 API, defined with Mastra's `createTool`. Each tool is a thin wrapper
 * that forwards to the hosted Cite42 REST API (via `client.ts`) using the user's `cite42_live_` key —
 * keeping all billing/metering server-side. The tool names mirror the REST endpoints one-to-one.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  aivDelete,
  aivGet,
  aivPatch,
  aivPost,
  toUsd,
  toCite42Balance,
} from './client.js';

// MUST stay in sync with MODEL_IDS in apps/web/src/mastra/model-ids.ts — the hosted API rejects
// any model not in this set. `google_ai_overview` is the AI summary block in Google's SERP
// (sourced from a SERP read, not an LLM), a peer model the API fans out to like the rest.
const modelEnum = z.enum(['chatgpt', 'claude', 'perplexity', 'gemini', 'google_ai_overview']);
const QUERY_MAX_CHARS = 2_000;
const SHORT_TEXT_MAX_CHARS = 200;
const TIMEFRAME_MAX_CHARS = 80;
// These two repeat on every model-backed tool in tools/list, so they stay short.
const MODEL_SELECTION_DESCRIPTION =
  'AI surfaces to query, each billed separately; pass a subset when the user names surfaces or ' +
  'wants a lower cost. Omit for the defaults (chatgpt, perplexity, gemini); fullSweep queries ' +
  'all five. google_ai_overview accepts queries up to 700 characters, the others 2000.';

const FULL_SWEEP_DESCRIPTION =
  'Query all five AI surfaces (adds claude and google_ai_overview) for full cross-surface ' +
  'coverage, at a higher cost. Ignored when models is given.';

/**
 * Mirrors the hosted server's billing sentence (apps/web/src/app/mcp/route.ts) — keep the two in
 * step. Appended to every paid tool, so it stays one sentence; directory review rejects
 * descriptions that tell the model how to behave, so it states billing facts. The confirmation
 * threshold stays because it is the only brake on spend once `readOnlyHint` lets these run
 * without per-call confirmation.
 */
const PAID_TOOL_BILLING =
  'Billed in USD (result field cite42Billing) to the user\'s prepaid Cite42 balance; exact prices ' +
  'from cite42_pricing (free). For plans over 20 calls or $5, estimate the cost and confirm with ' +
  'the user first.';

/** "When the user asks" keeps the pointer from inviting a paid report after every measurement. */
const RECOMMENDATIONS_INPUT_NOTE =
  'Its requestId can be passed to cite42_recommendations when the user asks for improvement advice.';

const MODEL_PRICING = 'Priced per AI surface queried.';

/**
 * Keywords is the one data tool NOT flat-priced: it bills by outcome, cheapest when the seed has
 * no search volume. Stating that here stops an agent from skipping an affordable lookup because
 * it assumed the ideas-tier ceiling applied to every call.
 */
const KEYWORDS_PRICING =
  'Billed by outcome: cheapest when the seed has no search volume, more when it has metrics, ' +
  'most with ideas:true.';

const WORKFLOW_PRICING = 'Billed for the steps that succeed, at per-surface rates.';

/** Matches `workflowToolDescription()` on the hosted server. */
function workflowDescription(description: string): string {
  return `${description} ${WORKFLOW_PRICING} ${PAID_TOOL_BILLING}`;
}

/**
 * Mirrors the hosted server's annotations (apps/web/src/app/mcp/route.ts). Mastra forwards
 * `mcp.annotations` straight into the tools/list spec, so this is the stdio equivalent of the
 * hosted `readOnly()` helper. Primitive and reporting tools are read-only; tracker lifecycle
 * tools declare whether they replace or remove Cite42-owned state. OpenAI's review wants all three
 * hints explicit on every tool. `openWorldHint` is false for tools that only access the caller's
 * own Cite42 record.
 */
function readOnly(title: string, openWorldHint = true) {
  return { annotations: { title, readOnlyHint: true, destructiveHint: false, openWorldHint } };
}

function mutation(
  title: string,
  options: {
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    idempotentHint?: boolean;
  } = {}
) {
  return {
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: options.destructiveHint ?? false,
      openWorldHint: options.openWorldHint ?? false,
      ...(options.idempotentHint === undefined
        ? {}
        : { idempotentHint: options.idempotentHint }),
    },
  };
}

function queryText(description: string) {
  return z.string().trim().min(1).max(QUERY_MAX_CHARS).describe(description);
}

function shortText(description: string) {
  return z.string().trim().min(1).max(SHORT_TEXT_MAX_CHARS).describe(description);
}

export const aivRecommendations = createTool({
  id: 'cite42_recommendations',
  mcp: readOnly('Recommend AI visibility next steps'),
  description: 'Page-level AI visibility recommendations, for when the user asks how to improve a page. With a saved result (requestId, trackerRunId or evidence) it ' +
    'reports on one measured prompt, charged only when the report includes page-comparison advice backed by quotes from ' +
    'inspected pages. Without one: url alone runs a free technical check of the page (robots.txt crawler access, indexing, ' +
    'rendering) and returns suggested buyer questions; url with query first runs a citations check, priced like ' +
    'cite42_citations, then the report. Prices are in cite42_pricing. Fetches the page, its robots.txt and up to two pages ' +
    'the AI surfaces cited, as returned HTML without JavaScript. No site-wide crawl, keyword advice or tracker activation. ' +
    PAID_TOOL_BILLING,
  inputSchema: z.object({
    requestId: z.string().trim().min(1).max(128).optional()
      .describe('A requestId from your own successful Cite42 call within the last 30 days.'),
    trackerRunId: z.string().trim().min(1).max(128).optional()
      .describe('A specific finished run of your own tracker within the last 30 days.'),
    evidence: z.array(z.object({
      primitive: z.enum(['rankings', 'compare', 'citations', 'sentiment']),
      input: z.record(z.string(), z.unknown()), result: z.record(z.string(), z.unknown()),
      measuredAt: z.string().datetime(),
    })).min(1).max(20).optional(),
    url: z.string().trim().url().max(2_000).optional()
      .describe('Your page that should answer the prompt. Without a saved result, url alone runs a free technical check; ' +
        'url with query runs a citations check first.'),
    query: z.string().trim().min(1).max(2_000).optional()
      .describe('A buyer question. With a saved result it picks one measured prompt; without one it is the question measured.'),
    models: z.array(modelEnum).nonempty().optional()
      .describe('AI surfaces for the citations check that runs without a saved result. Ignored with a saved result.'),
    context: z.object({
      brand: z.string().trim().min(1).max(200).optional(),
      domain: z.string().trim().min(1).max(250).optional(),
      audience: z.string().trim().min(1).max(400).optional(),
      goal: z.string().trim().min(1).max(400).optional(),
    }).optional(),
  }).superRefine((input, ctx) => {
    const sources = [input.requestId, input.trackerRunId, input.evidence].filter((value) => value !== undefined).length;
    if (sources > 1) ctx.addIssue({ code: 'custom', message: 'Provide at most one of requestId, trackerRunId or evidence.' });
    if (sources === 0 && !input.url) {
      ctx.addIssue({ code: 'custom', message: 'Provide requestId, trackerRunId or evidence, or url for a page without saved results.' });
    }
    if (sources === 0 && input.query && (input.url?.length ?? 0) > 500) {
      ctx.addIssue({ code: 'custom', message: 'url must be at most 500 characters to run a citations check.' });
    }
    if (new TextEncoder().encode(JSON.stringify(input)).length > 64 * 1024) {
      ctx.addIssue({ code: 'custom', message: 'Recommendation input must fit within 64KB.' });
    }
  }),
  execute: async (input) => aivPost('/recommendations', input),
});

function optionalShortText(description: string) {
  return z.string().trim().min(1).max(SHORT_TEXT_MAX_CHARS).optional().describe(description);
}

const modelsInput = z
  .array(modelEnum)
  .nonempty()
  .optional()
  .describe(MODEL_SELECTION_DESCRIPTION);

const fullSweepInput = z.boolean().optional().describe(FULL_SWEEP_DESCRIPTION);

const competitorList = z
  .array(shortText('Competitor brand/domain name.'))
  .nonempty()
  .max(20);

/** GET /v1/usage also returns recent usage rows; the balance tools only surface the branded balance. */
async function fetchBalance() {
  const usage = await aivGet<{ balance?: { microCredits?: number } }>('/usage');
  const micro = usage.balance?.microCredits;
  if (typeof micro !== 'number' || !Number.isFinite(micro)) {
    throw new Error('Cite42 usage response did not include a balance.');
  }
  return toCite42Balance(micro);
}

export const aivBalance = createTool({
  id: 'cite42_balance',
  mcp: readOnly('Check Cite42 balance', false),
  description: 'Check the remaining Cite42 balance in USD for the connected account. Free.',
  inputSchema: z.object({}),
  execute: fetchBalance,
});

// Kept by name so older integrations that call it keep working; it answers exactly like
// cite42_balance now that credits are retired.
export const aivCredits = createTool({
  id: 'cite42_credits',
  mcp: readOnly('Check Cite42 balance (legacy alias)', false),
  description: 'Alias of cite42_balance for older integrations. Free.',
  inputSchema: z.object({}),
  execute: fetchBalance,
});

export const aivPricing = createTool({
  id: 'cite42_pricing',
  mcp: readOnly('Get Cite42 price table', false),
  description:
    'Get the exact Cite42 price table in USD: per-surface rates, flat-rate tools, workflow ' +
    'maximums, and which tools are free. Use it for cost questions and to estimate a plan ' +
    'before running it. Free.',
  // No currency switch: prices are USD only. An older client's `currency` argument is ignored.
  inputSchema: z.object({}),
  execute: async () => aivGet('/pricing?currency=USD'),
});

export const aivUsage = createTool({
  id: 'cite42_usage',
  mcp: readOnly('Get recent Cite42 usage', false),
  description:
    'Get recent Cite42 usage for the connected account: the last calls with their cost and status, plus the remaining ' +
    'balance in USD. Free.',
  inputSchema: z.object({}),
  execute: async () => {
    const usage = await aivGet<{
      balance?: { microCredits?: number };
      recent?: Array<{ endpoint?: string; status?: number; costMicro?: number; createdAt?: string }>;
    }>('/usage');
    const micro = usage.balance?.microCredits;
    if (typeof micro !== 'number' || !Number.isFinite(micro)) {
      throw new Error('Cite42 usage response did not include a balance.');
    }
    return {
      ...toCite42Balance(micro),
      recentCalls: (usage.recent ?? []).slice(0, 20).map((row) => ({
        endpoint: row.endpoint,
        status: row.status,
        costUsd: typeof row.costMicro === 'number' ? toUsd(row.costMicro) : undefined,
        at: row.createdAt,
      })),
    };
  },
});

export const aivSearch = createTool({
  id: 'cite42_search',
  mcp: readOnly('Search AI models'),
  description:
    'Run a query against AI models (ChatGPT, Claude, Perplexity, Gemini, and Google AI ' +
    "Overviews) and return each model's answer along with the sources it cited. " +
    `${MODEL_PRICING} ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    query: queryText('The concise AI-search/market-research query to run against the selected models.'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input) => aivPost('/search', input),
});

export const aivCitations = createTool({
  id: 'cite42_citations',
  mcp: readOnly('Find AI citations'),
  description:
    "Find which sources a model's web search surfaces for a query. Aggregates cited URLs " +
    'across models with per-model counts; optionally checks whether a specific URL is cited. ' +
    'Measures the retrieval corpus behind a prompt — which domains own your category in AI ' +
    'search, and where your content is missing — not the citation links a consumer chat UI ' +
    `renders for a logged-in user. ${RECOMMENDATIONS_INPUT_NOTE} ${MODEL_PRICING} ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    query: queryText('The concise query to look up cited sources for.'),
    url: z.string().trim().max(500).optional().describe('Optional URL to check whether it was cited.'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input) => aivPost('/citations', input),
});

export const aivRankings = createTool({
  id: 'cite42_rankings',
  mcp: readOnly('Measure AI brand rankings'),
  description:
    'Measure how a set of brands/competitors rank in AI answers for a query: mention rate, ' +
    'average position, and a per-model breakdown across ChatGPT, Claude, Perplexity, Gemini, ' +
    `and Google AI Overviews. ${RECOMMENDATIONS_INPUT_NOTE} ${MODEL_PRICING} ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    query: queryText('The concise query to measure brand/competitor visibility on.'),
    competitors: competitorList.describe('Brand or domain names to track within the AI-generated answers.'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input) => aivPost('/rankings', input),
});

export const aivCompare = createTool({
  id: 'cite42_compare',
  mcp: readOnly('Compare brand against competitors'),
  description:
    'Compare one primary brand head-to-head against a competitor set in AI answers: per-brand ' +
    'rankings plus a co-mention graph of which brands the models name together. ' +
    `${RECOMMENDATIONS_INPUT_NOTE} ${MODEL_PRICING} ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    query: queryText('The concise query to compare the brand and competitors on.'),
    brand: shortText('Your brand, ranked alongside the competitors.'),
    competitors: z
      .array(shortText('Competitor brand/domain name.'))
      .nonempty()
      .max(10)
      .describe('Competitor brand/domain names (up to 10) to rank against your brand.'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input) => aivPost('/compare', input),
});

export const aivSentiment = createTool({
  id: 'cite42_sentiment',
  mcp: readOnly('Score brand sentiment in AI answers'),
  description:
    'Score how each AI model talks about a brand for a query: a positive/neutral/negative split ' +
    'per model with the verbatim phrases driving the tone, plus an aggregate across models. ' +
    `${RECOMMENDATIONS_INPUT_NOTE} ${MODEL_PRICING} ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    query: queryText('The concise query whose answers are scored for brand sentiment.'),
    brand: shortText('The brand to score sentiment for in each model answer.'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input) => aivPost('/sentiment', input),
});

export const aivKeywords = createTool({
  id: 'cite42_keywords',
  mcp: readOnly('Get SEO keyword data'),
  description:
    'Classic keyword data for a seed term. Omit ideas when the user only needs that seed\'s monthly ' +
    'search volume, CPC, or competition. Set ideas:true only when the user asks for related, alternative, ' +
    'or long-tail suggestions from provider candidates. Not a multi-model AI-search query. The reply ' +
    'echoes requestedKeyword and carries status "exact" or "no_data"; when the seed has no search ' +
    'volume, any related term that does appears under alternatives — never treat an alternative\'s ' +
    `metrics as the requested keyword's. ${KEYWORDS_PRICING} ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    seed: queryText('Seed keyword or concise topic to fetch search volume, CPC, and competition for.'),
    country: z.string().trim().max(8).optional().describe('ISO-2 country code for localized metrics. Defaults to "us".'),
    language: z
      .string()
      .trim()
      .max(8)
      .optional()
      .describe(
        'Optional ISO-2 language code. Defaults to the country\'s primary search language, so country "de" searches in German. Only multilingual markets accept an override: us (en, es), ca (en, fr), in (en, hi). Every other country has a single search language and rejects anything else.'
      ),
    ideas: z
      .boolean()
      .optional()
      .describe(
        'Omit for volume, CPC, and competition on the seed only. Set true only for related, alternative, or long-tail keyword ideas.'
      ),
  }),
  execute: async (input) => aivPost('/keywords', input),
});

export const aivKeywordsBatch = createTool({
  id: 'cite42_keywords_batch',
  mcp: readOnly('Get batch SEO keyword data'),
  description:
    'Check search volume, CPC, and competition for two to 50 distinct seed keywords in one request. ' +
    `No related ideas. Billed by outcome. ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    seeds: z.array(z.string().trim().min(1).max(80).refine(
      (seed) => seed.split(/\s+/).length <= 10,
      'Each keyword must contain at most 10 words.'
    )).min(2).max(50).refine(
      (seeds) => new Set(seeds.map((seed) => seed.toLowerCase().replace(/\s+/g, ' '))).size === seeds.length,
      'Keywords must be distinct.'
    ).describe('Two to 50 distinct seed keywords.'),
    country: z.string().trim().max(8).optional()
      .describe('ISO-2 country code. Defaults to "us".'),
    language: z.string().trim().max(8).optional()
      .describe('Optional ISO-2 language code.'),
  }),
  execute: async (input) => aivPost('/keywords/batch', input),
});

export const aivTrends = createTool({
  id: 'cite42_trends',
  mcp: readOnly('Get Google Trends data'),
  description:
    'Google Trends interest-over-time, related and rising queries, and a rising/falling/stable ' +
    `label for a term. A flat-priced data tool, not an AI-model query. ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    term: queryText('Search term or concise topic to pull Google Trends interest-over-time for.'),
    timeframe: z
      .string()
      .trim()
      .max(TIMEFRAME_MAX_CHARS)
      .optional()
      .describe('Trends window, e.g. "past_12_months", "past_30_days", "past_5_years".'),
    geo: z
      .string()
      .trim()
      .max(SHORT_TEXT_MAX_CHARS)
      .optional()
      .describe('Optional location name (e.g. "United Kingdom"). Defaults to the United States when omitted.'),
  }),
  execute: async (input) => aivPost('/trends', input),
});

export const aivRedditTrends = createTool({
  id: 'cite42_reddit_trends',
  mcp: readOnly('Find Reddit discussions'),
  description:
    'Discover relevant Reddit discussions with Google Search and read up to three thread pages through Gemini URL context. ' +
    'Returns Gemini-read titles, authors, post excerpts, relative ages, available scores/comment counts and sampled human comments, ' +
    'plus cited model summaries. Check coverage and warnings: pages may be cached, extraction is not independently verified, ' +
    'and exact dates, growth and quote-based insights are unavailable. risingThreads is a deprecated alias of relevantThreads. ' +
    PAID_TOOL_BILLING,
  inputSchema: z.object({
    topic: queryText('Topic, category, product, or audience to research on Reddit.'),
    subreddits: z.array(shortText('Subreddit name without r/.')).max(20).optional().describe('Optional subreddit names, without r/.'),
    timeframe: z
      .string()
      .trim()
      .max(TIMEFRAME_MAX_CHARS)
      .optional()
      .describe('Conversation window, e.g. "past_7_days", "past_30_days", "past_90_days".'),
  }),
  execute: async (input, context) => aivPost('/reddit/trends', input, context?.abortSignal ?? context?.mcp?.extra.signal),
});

export const aivYoutubeTrends = createTool({
  id: 'cite42_youtube_trends',
  mcp: readOnly('Get YouTube trend data'),
  description:
    'YouTube trend data for rising videos, creator angles, title patterns, channel examples, ' +
    `and video-market opportunities around a topic. ${PAID_TOOL_BILLING}`,
  inputSchema: z.object({
    topic: queryText('Topic, keyword, niche, or audience to research on YouTube.'),
    region: z.string().trim().max(8).optional().describe('ISO-2 country/region code. Defaults to "US".'),
    timeframe: z
      .string()
      .trim()
      .max(TIMEFRAME_MAX_CHARS)
      .optional()
      .describe('Video-market window, e.g. "past_7_days", "past_30_days", "past_90_days".'),
  }),
  execute: async (input) => aivPost('/youtube/trends', input),
});

const channelEnum = z.enum(['ai_search', 'seo_keywords', 'google_trends', 'reddit', 'youtube']);

export const aivFindContentOpportunities = createTool({
  id: 'cite42_find_content_opportunities',
  mcp: readOnly('Find content opportunities'),
  description:
    workflowDescription(
      'Run the content-opportunities workflow: fans out across AI search, SEO keywords, trends, ' +
        'Reddit, YouTube, and citations and returns the aggregated data in one response.'
    ),
  inputSchema: z.object({
    topic: queryText('Market, niche, product category, or audience to research.'),
    audience: optionalShortText('Optional target audience or ICP.'),
    brand: optionalShortText('Optional brand/domain to account for.'),
    competitors: competitorList.optional().describe('Competitor brands/domains.'),
    country: z.string().trim().max(8).optional().describe('ISO-2 country code. Defaults to "us".'),
    channels: z.array(channelEnum).optional().describe('Optional data sources to include.'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input, context) => aivPost('/workflows/content-opportunities', input, context?.abortSignal ?? context?.mcp?.extra.signal),
});

export const aivAnalyzeTopicDemand = createTool({
  id: 'cite42_analyze_topic_demand',
  mcp: readOnly('Analyze topic demand'),
  description:
    workflowDescription(
      'Run the topic-demand workflow: SEO keyword data, Google Trends, AI answers, and audience ' +
        'conversations, aggregated in one response.'
    ),
  inputSchema: z.object({
    topic: queryText('Topic, keyword, category, or audience demand to analyze.'),
    country: z.string().trim().max(8).optional().describe('ISO-2 country code. Defaults to "us".'),
    timeframe: z.string().trim().max(TIMEFRAME_MAX_CHARS).optional().describe('Trend window. Defaults to "past_12_months".'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input, context) => aivPost('/workflows/topic-demand', input, context?.abortSignal ?? context?.mcp?.extra.signal),
});

export const aivMapAiPrompts = createTool({
  id: 'cite42_map_ai_prompts',
  mcp: readOnly('Map buyer prompts for AI search'),
  description:
    workflowDescription(
      'Run the AI-prompt-map workflow: research for a list of buyer prompts worth tracking, from AI ' +
        'search, SEO demand, trends, citations, Reddit, and YouTube data. It returns evidence and a ' +
        'suggested prompt, not a finished list; prompts written from it can be tracked with ' +
        'cite42_tracker_create.'
    ),
  inputSchema: z.object({
    topic: queryText('Market, product category, buyer problem, or audience to map prompts for.'),
    audience: optionalShortText('Optional target audience or ICP.'),
    brand: optionalShortText('Optional brand/domain to include in prompt tracking recommendations.'),
    competitors: competitorList.optional().describe('Competitor brands/domains.'),
    country: z.string().trim().max(8).optional().describe('ISO-2 country code. Defaults to "us".'),
    timeframe: z.string().trim().max(TIMEFRAME_MAX_CHARS).optional().describe('Trend window. Defaults to "past_12_months".'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input, context) => aivPost('/workflows/ai-prompt-map', input, context?.abortSignal ?? context?.mcp?.extra.signal),
});

export const aivAnalyzeCompetitorContent = createTool({
  id: 'cite42_analyze_competitor_content',
  mcp: readOnly('Analyze competitor content'),
  description:
    workflowDescription(
      'Run the competitor-content workflow: AI rankings, head-to-head comparison, citations, keyword ' +
        'demand, and topic coverage, aggregated in one response.'
    ),
  inputSchema: z.object({
    competitors: competitorList.describe('Competitor brands, domains, or channels to analyze.'),
    topic: z.string().trim().min(1).max(QUERY_MAX_CHARS).optional().describe('Optional topic/category to constrain the analysis.'),
    brand: optionalShortText('Optional primary brand/domain to compare against.'),
    country: z.string().trim().max(8).optional().describe('ISO-2 country code. Defaults to "us".'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input, context) => aivPost('/workflows/competitor-content', input, context?.abortSignal ?? context?.mcp?.extra.signal),
});

export const aivFindAiCitationGaps = createTool({
  id: 'cite42_find_ai_citation_gaps',
  mcp: readOnly('Find AI citation gaps'),
  description:
    workflowDescription(
      'Run the AI-citation-gaps workflow: find queries where AI answers cite others but not your ' +
        'brand, domain, or URL, with the supporting data.'
    ),
  inputSchema: z.object({
    query: queryText('AI-search query to inspect for citation gaps.'),
    brand: shortText('Brand or domain that should earn citations.'),
    url: z.string().trim().max(500).optional().describe('Optional exact URL to check for citations.'),
    competitors: competitorList.optional().describe('Competitor brands/domains.'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input, context) => aivPost('/workflows/ai-citation-gaps', input, context?.abortSignal ?? context?.mcp?.extra.signal),
});

export const aivGenerateContentBrief = createTool({
  id: 'cite42_generate_content_brief',
  mcp: readOnly('Generate content brief data'),
  description:
    workflowDescription(
      'Run the content-brief workflow: research for a content brief from AI answers, citations, SEO ' +
        'keyword demand, trends, Reddit, and YouTube signals. It returns evidence and a suggested ' +
        'prompt; write the brief from it.'
    ),
  inputSchema: z.object({
    topic: queryText('Topic, keyword, or content idea to brief.'),
    audience: optionalShortText('Optional target audience or ICP.'),
    brand: optionalShortText('Optional brand/domain the brief is for.'),
    goal: optionalShortText('Optional content goal, e.g. rank, earn citations, convert.'),
    country: z.string().trim().max(8).optional().describe('ISO-2 country code. Defaults to "us".'),
    models: modelsInput,
    fullSweep: fullSweepInput,
  }),
  execute: async (input, context) => aivPost('/workflows/content-brief', input, context?.abortSignal ?? context?.mcp?.extra.signal),
});

const trackerIdInput = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .describe('Cite42 tracker ID returned by a tracker management or report tool.');

const trackerCadenceInput = z
  .object({
    frequency: z.enum(['weekly', 'monthly']),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((timezone) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Timezone must be a valid IANA timezone.')
      .describe('IANA timezone, for example Europe/London or America/New_York.'),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .describe('Local run time in 24-hour HH:mm format.'),
    weekday: z
      .number()
      .int()
      .min(0)
      .max(6)
      .optional()
      .describe('Weekly trackers only. Day of week, where 0 is Sunday and 6 is Saturday.'),
    monthday: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe(
        'Monthly trackers only. Day of month 1-31; a value past the end of a shorter month runs ' +
          'on that month\'s last day, so 31 always means "month end".'
      ),
  })
  .superRefine((cadence, context) => {
    if (cadence.frequency === 'weekly' && cadence.weekday === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['weekday'],
        message: 'weekday is required for a weekly tracker',
      });
    }
    if (cadence.frequency === 'monthly' && cadence.monthday === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['monthday'],
        message: 'monthday is required for a monthly tracker',
      });
    }
  });

/**
 * A tracker is one measurement applied to a list of prompts: the prompt is the only thing that
 * varies between the calls a run makes, so everything else is set once here.
 *
 * MUST stay in sync with `trackerUpsertInput` in
 * apps/web/src/shared/lib/tracker/schemas.ts — the hosted API is the validator, and
 * `npx tsx scripts/contracts.ts` asserts these field names match it. Note there is deliberately no
 * `fullSweep`: a saved tracker stores the exact surface list its cost was authorized for.
 */
const trackerPrimitiveInput = z
  .enum(['rankings', 'compare', 'citations', 'sentiment'])
  .describe(
    'What to measure on every prompt: rankings (which brands get named), compare (the brand ' +
      'against named competitors), citations (which sources are cited), or sentiment (how one ' +
      'brand is described). One measurement per tracker.'
  );

const trackerPromptsInput = z
  .array(queryText('A prompt to run on every scheduled run.'))
  .min(1)
  .max(25)
  .describe(
    'Prompts to track, up to 30. Each is billed as its own call on every run. Keep the wording ' +
      'stable so runs stay comparable, avoid dates, and do not repeat a prompt.'
  );

const trackerDefinitionFields = {
  name: z.string().trim().min(1).max(100).describe('Human-readable tracker name.'),
  cadence: trackerCadenceInput,
  primitive: trackerPrimitiveInput,
  prompts: trackerPromptsInput,
  brand: z
    .string()
    .trim()
    .min(1)
    .max(SHORT_TEXT_MAX_CHARS)
    .nullish()
    .describe('Required for compare and sentiment. Not used by rankings or citations.'),
  competitors: z
    .array(shortText('Brand or domain name.'))
    .max(20)
    .nullish()
    .describe(
      'Required for rankings (the brands to track, including your own) and compare (the rivals to ' +
        'rank against, up to 10). Not used by citations or sentiment.'
    ),
  url: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .nullish()
    .describe('Citations only: a URL to report on as cited or not cited.'),
  models: z
    .array(modelEnum)
    .nonempty()
    .nullish()
    .describe(
      'AI surfaces to query for every prompt. Omit for the three defaults (chatgpt, perplexity, ' +
        'gemini), or list surfaces explicitly — including all five — to fix the recurring cost.'
    ),
};

const TRACKER_BILLING_DESCRIPTION =
  'Managing trackers and reading reports is free; each run bills one call per prompt at the ' +
  'per-surface rates.';

export const aivTrackerCreate = createTool({
  id: 'cite42_tracker_create',
  mcp: mutation('Create Cite42 tracker draft'),
  description:
    'Create a draft weekly or monthly tracker: one measurement — rankings, compare, citations, or ' +
    'sentiment — applied to a list of prompts, with the brand, competitors and AI surfaces set once ' +
    'for all of them. Prompt lists can come from cite42_map_ai_prompts research. Creation does ' +
    'not start recurring calls. ' +
    TRACKER_BILLING_DESCRIPTION,
  inputSchema: z.object(trackerDefinitionFields),
  execute: async (input) => aivPost('/trackers', input),
});

export const aivTrackerUpdate = createTool({
  id: 'cite42_tracker_update',
  mcp: mutation('Update Cite42 tracker', { destructiveHint: true }),
  description:
    'Replace a tracker definition: name, cadence, measurement, prompts and configuration. Send the ' +
    'complete definition, not a partial patch — a tracker read returns this exact shape, so read ' +
    'it, change what you need, and send it back. An edit returns the tracker to draft so its new ' +
    `recurring cost can be confirmed. ${TRACKER_BILLING_DESCRIPTION}`,
  inputSchema: z.object({ trackerId: trackerIdInput, ...trackerDefinitionFields }),
  execute: async ({ trackerId, ...input }) =>
    aivPatch(`/trackers/${encodeURIComponent(trackerId)}`, input),
});

export const aivTrackerActivate = createTool({
  id: 'cite42_tracker_activate',
  mcp: mutation('Activate Cite42 tracker', {
    openWorldHint: true,
    idempotentHint: true,
  }),
  description:
    'Activate or resume recurring weekly or monthly tool calls. maxCostMicroPerRun must equal ' +
    'the tracker\'s latest estimatedCostMicroPerRun; activation authorizes future billed calls ' +
    'until paused. The response includes the balance, the cost per run, and runsDryAt, the date ' +
    'the balance stops covering active trackers. When tracker emails are enabled, activation ' +
    'sends a setup summary and every completed run sends current results and suggested next ' +
    'steps, even when nothing changed. Activation is refused when the balance cannot cover the ' +
    `next run. ${TRACKER_BILLING_DESCRIPTION}`,
  inputSchema: z.object({
    trackerId: trackerIdInput,
    maxCostMicroPerRun: z
      .number()
      .int()
      .nonnegative()
      .describe('Exact estimatedCostMicroPerRun returned by the latest tracker record.'),
  }),
  execute: async ({ trackerId, maxCostMicroPerRun }) =>
    aivPost(`/trackers/${encodeURIComponent(trackerId)}/activate`, { maxCostMicroPerRun }),
});

export const aivTrackerPause = createTool({
  id: 'cite42_tracker_pause',
  mcp: mutation('Pause Cite42 tracker', { idempotentHint: true }),
  description:
    'Pause future recurring calls for a tracker while preserving its configuration and stored run history. Free.',
  inputSchema: z.object({ trackerId: trackerIdInput }),
  execute: async ({ trackerId }) =>
    aivPost(`/trackers/${encodeURIComponent(trackerId)}/pause`, {}),
});

export const aivTrackerDelete = createTool({
  id: 'cite42_tracker_delete',
  mcp: mutation('Permanently delete Cite42 tracker', {
    destructiveHint: true,
    idempotentHint: true,
  }),
  description:
    'Permanently delete a draft or paused tracker, including its saved configuration and run ' +
    'history. Active trackers must be paused first, and deletion is rejected while a run is ' +
    'queued or running. Financial usage and billing ledger records are retained. Free.',
  inputSchema: z.object({ trackerId: trackerIdInput }),
  execute: async ({ trackerId }) =>
    aivDelete(`/trackers/${encodeURIComponent(trackerId)}`),
});

export const aivTrackerRun = createTool({
  id: 'cite42_tracker_run',
  mcp: mutation('Run Cite42 tracker now', {
    openWorldHint: true,
    idempotentHint: true,
  }),
  description:
    'Queue one manual run using the tracker’s saved tool inputs. A repeated requestToken ' +
    `returns the same logical run. ${TRACKER_BILLING_DESCRIPTION}`,
  inputSchema: z.object({
    trackerId: trackerIdInput,
    requestToken: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Stable caller-generated token used to deduplicate a retried manual run.'),
  }),
  execute: async ({ trackerId, requestToken }) =>
    aivPost(`/trackers/${encodeURIComponent(trackerId)}/runs`, { requestToken }),
});

export const aivTrackers = createTool({
  id: 'cite42_trackers',
  mcp: readOnly('List Cite42 trackers', false),
  description:
    'List the connected account’s trackers with status, cadence, tool configuration, cost ' +
    'estimate, accepted per-run maximum, and next/last run times. Free.',
  inputSchema: z.object({}),
  execute: async () => aivGet('/trackers'),
});

export const aivTrackerReport = createTool({
  id: 'cite42_tracker_report',
  mcp: readOnly('Read Cite42 tracker report', false),
  description:
    'Read bounded stored run history for one tracker, including per-tool results, changes from ' +
    'the prior comparable observation, statuses, sampled times, and costs. Free.',
  inputSchema: z.object({
    trackerId: trackerIdInput,
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(8)
      .describe('Most recent runs to return, capped for LLM context.'),
  }),
  execute: async ({ trackerId, limit }) =>
    aivGet(`/trackers/${encodeURIComponent(trackerId)}/report?limit=${limit}`),
});
