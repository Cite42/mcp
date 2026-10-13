# Cite42 MCP server

[![npm](https://img.shields.io/npm/v/@cite42/mcp)](https://www.npmjs.com/package/@cite42/mcp)
[![CI](https://github.com/Cite42/mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Cite42/mcp/actions/workflows/ci.yml)
[![Cite42 MCP connector – tool definition quality and endpoint health on Glama](https://glama.ai/mcp/connectors/dev.cite42/mcp/badges/score.svg)](https://glama.ai/mcp/connectors/dev.cite42/mcp)

Cite42 is an MCP server for AI visibility and SEO data. Connect it to Claude Code, Codex, Cursor, Claude Desktop or ChatGPT, and your agent can check whether the AI models behind ChatGPT, Claude, Perplexity and Gemini, plus Google AI Overviews, mention your brand and which sources they cite. It also pulls keyword search volume, Google Trends, Reddit and YouTube data.

You pay per call from a prepaid USD balance. There is no subscription, and new accounts get $1 of free credit. See [pricing](https://www.cite42.dev/pricing).

## What you can do with it

### Check whether AI answers mention your brand

Ask a buyer question such as "best invoicing software for freelancers" and see which brands each AI model names, in what order, and how often (`cite42_rankings`). Compare your brand with named competitors (`cite42_compare`), or see how the answers describe it (`cite42_sentiment`).

### See which sources AI answers cite

`cite42_citations` lists the URLs the AI models cited for a question and can check whether your page or domain is among them. `cite42_search` returns each model's full answer with its sources. `cite42_recommendations` compares your page with the pages that did get cited.

### Keyword search volume, CPC and competition

`cite42_keywords` returns monthly search volume, CPC and competition for a keyword, with optional related keyword ideas. `cite42_keywords_batch` checks up to 50 keywords in one call.

### Google Trends

`cite42_trends` returns Google Trends interest over time, related and rising queries, and a trend label.

### Reddit and YouTube research

`cite42_reddit_trends` finds relevant Reddit discussions with cited summaries. `cite42_youtube_trends` finds rising videos, creator angles and title patterns.

### Track prompts weekly or monthly

A tracker reruns a list of up to 30 prompts on a schedule and keeps the run history, so you can see when AI answers start or stop naming you.

### Run research workflows in one call

Six workflows combine the tools above: content opportunities, topic demand, AI prompt maps, competitor content, AI citation gaps and content briefs.

## Requirements

- **A Cite42 account**, free to create at [cite42.dev](https://www.cite42.dev)
- For the API-key setup only: **Node.js 22.13 or newer and a Cite42 API key**

## Installation

Most clients connect to the hosted server at `https://mcp.cite42.dev` and sign in with your Cite42 account in the browser. There is no API key to create or paste, and nothing to install locally. For CI, servers, or machines without a browser, run this package with an API key instead; see [API key setup](#api-key-setup-ci-servers-no-browser).

### Claude Code

```bash
claude mcp add --transport http --scope user cite42 https://mcp.cite42.dev && claude mcp login cite42
```

Your browser opens to sign in. Then start Claude Code, or restart it if it was already open, and check with `/mcp`.

### Codex CLI

```bash
codex mcp add cite42 --url https://mcp.cite42.dev
```

Codex opens your browser to sign in. If it doesn't, run `codex mcp login cite42`. Then start a new session.

### Cursor

[Add to Cursor](https://cursor.com/install-mcp?name=cite42&config=eyJ1cmwiOiJodHRwczovL21jcC5jaXRlNDIuZGV2In0%3D), or add this under **Settings → MCP**, or in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cite42": { "url": "https://mcp.cite42.dev" }
  }
}
```

Sign in with your Cite42 account when Cursor asks.

### Claude Desktop and Claude.ai

[Add to Claude](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Cite42&connectorUrl=https%3A%2F%2Fmcp.cite42.dev) opens the connector dialog with Cite42 filled in. Or open **Settings → Connectors → Add custom connector**, name it **Cite42**, and paste `https://mcp.cite42.dev`. Click **Connect** and sign in. The connector appears in both Claude Desktop and Claude.ai.

### ChatGPT and Codex Desktop

Turn on **Developer mode** in **Settings → Security and login**, then add a plugin under **Settings → Plugins** with the MCP server URL `https://mcp.cite42.dev` and **OAuth**.

### API key setup (CI, servers, no browser)

Create a key at [www.cite42.dev/app/keys](https://www.cite42.dev/app/keys) (it looks like `cite42_live_...` and is shown once), then replace `cite42_live_your_key_here` below. The client starts this package on demand; you don't need to keep it running.

```bash
# Claude Code
claude mcp add --scope user cite42 -e CITE42_API_KEY=cite42_live_your_key_here -- npx -y @cite42/mcp

# Codex CLI
codex mcp add cite42 --env CITE42_API_KEY=cite42_live_your_key_here -- npx -y @cite42/mcp
```

For Cursor, save this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cite42": {
      "command": "npx",
      "args": ["-y", "@cite42/mcp"],
      "env": {
        "CITE42_API_KEY": "cite42_live_your_key_here"
      }
    }
  }
}
```

Restart the client afterwards: a new terminal or `claude`/`codex` session, or fully quit and reopen Cursor.

### Verify it's running

- **Claude Code:** run `claude mcp list` and check that `cite42` shows as connected, or type `/mcp` inside a session.
- **Codex CLI:** run `codex mcp list`.
- **Cursor:** look for `cite42` in the MCP/tools indicator.
- **Claude Desktop / Claude.ai:** open **Settings → Connectors** and confirm Cite42 is connected.

If it doesn't appear, see [Troubleshooting](#troubleshooting).

## Try it: example prompts

After connecting or restarting, just ask in plain language. Your agent picks the right Cite42 tool automatically.

- *"Use Cite42 to check which brands AI models recommend for 'best project management software'."*
- *"Which sources do AI models cite when asked about CRM tools for startups? Is mycompany.com among them?"*
- *"Get search volume, CPC, and related keywords for 'ai seo tools'."*
- *"Is interest in 'ai seo' rising on Google Trends? Show the related rising queries."*
- *"What are people on Reddit complaining about regarding email marketing tools?"*
- *"Run a content brief for the topic 'ai website builder'."*
- *"Map the prompts worth tracking for our category, then create a weekly Cite42 rankings tracker for the best five. Show me the estimated cost in USD per run before activating it."*

### Example: what a session looks like

**You ask:**

> Use Cite42 to find AI-cited competitors for "best invoicing software for freelancers".

**Your agent calls** `cite42_citations` **and answers something like:**

> Across ChatGPT, Perplexity, and Gemini, the most-cited sources are:
>
> 1. **freshbooks.com** (cited by 3/3 models)
> 2. **wave.com** (cited by 2/3 models)
> 3. **zoho.com/invoice** (cited by 2/3 models)
> 4. **bonsai.com** (cited by 1/3 models)
>
> Your domain wasn't cited by any model. FreshBooks is cited mainly via comparison/"best of" listicles. A citation-gap analysis (`cite42_find_ai_citation_gaps`) can show which queries you're missing from.

That is the three default surfaces; ask for `fullSweep` to add Claude and Google AI Overviews. The exact brands and sources change by query and model. A good result should show the tool used, model/source evidence, and a short summary you can act on.

## Tools

Cite42 exposes 29 MCP tools: 4 free account tools (including the compatibility alias), 11 data/report tools, 6 research workflows, and 8 tracker tools.

### Account & pricing (free)

- `cite42_balance`: check the connected account’s remaining Cite42 balance in USD.
- `cite42_credits`: alias of `cite42_balance` for older integrations.
- `cite42_pricing`: get current per-tool prices and estimate a planned set of calls.
- `cite42_usage`: read recent call status and cost together with the remaining balance.

### AI search visibility

- `cite42_search`: run a query against ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews. Returns each model's answer plus cited sources.
- `cite42_citations`: aggregate which URLs the AI models cite for a query. Can also check whether a specific URL is cited.
- `cite42_rankings`: measure how brands rank in AI answers, including mention rate, average position, and per-model breakdown.
- `cite42_compare`: compare one brand against competitors in AI answers.
- `cite42_sentiment`: score positive, neutral, and negative sentiment for a brand, with supporting phrases.
- `cite42_recommendations`: page-level recommendations. A page URL alone gets a free technical check with suggested buyer questions; with a buyer question it measures citations and compares your page with up to two pages the AI surfaces cited, charged only when it includes verified page-comparison advice (plus the citations check it ran).

### SEO & trend data

- `cite42_keywords`: get seed search volume, CPC, and competition, with optional related keyword ideas.
- `cite42_keywords_batch`: check volume, CPC, and competition for two to 50 seed keywords in one request; billed by outcome (call `cite42_pricing` for rates).
- `cite42_trends`: get Google Trends interest over time, related and rising queries, and a trend label.
- `cite42_reddit_trends`: find relevant Reddit discussions with cited summaries and read up to three pages through Gemini URL context. Returns page titles, authors, post excerpts, relative ages, available scores/comment counts and sampled human comments. Pages may be cached and model extraction is not independently verified. Exact dates, growth and quote-based insight arrays remain unavailable. Read `relevantThreads`; `risingThreads` is a deprecated compatibility alias. Check `coverage` and `warnings` for missing fields and out-of-window threads.
- `cite42_youtube_trends`: find YouTube rising videos, creator angles, title patterns, and opportunities.

### Research workflows (multi-source, one call)

- `cite42_find_content_opportunities`: find content gaps across AI search, keywords, trends, Reddit, YouTube, and citations.
- `cite42_analyze_topic_demand`: combine keyword data, trends, AI answers, and audience conversations for a topic.
- `cite42_map_ai_prompts`: discover and cluster buyer prompts worth tracking in AI search. Its prompts are what `cite42_tracker_create` takes, so the two chain naturally.
- `cite42_analyze_competitor_content`: analyze AI rankings, comparisons, citations, and topic coverage for competitors.
- `cite42_find_ai_citation_gaps`: find queries where AI answers cite competitors but not your brand, domain, or URL.
- `cite42_generate_content_brief`: collect AI answers, citations, keyword demand, and social signals into brief-ready data.

### Trackers

- `cite42_tracker_create`: create a draft weekly or monthly tracker — one measurement applied to a list of prompts. No prompt list yet? Run `cite42_map_ai_prompts` first. Creating a draft is free and does not schedule calls.
- `cite42_tracker_update`: replace the whole tracker definition — name, cadence, measurement, prompts and configuration. A tracker read returns the same shape, so read it, change what you need, and send it back. Updating is free.
- `cite42_tracker_activate`: activate or resume recurring runs. You must pass the exact `estimatedCostMicroPerRun` from the latest tracker record as `maxCostMicroPerRun`; activation authorizes billed scheduled runs until the tracker is paused. The response carries the balance, the cost per run and `runsDryAt` — the date the balance stops covering your active trackers — and activation is refused when the balance cannot cover even the next run. When tracker emails are on, activation also sends a setup summary.
- `cite42_tracker_pause`: stop future scheduled runs while preserving configuration and history. Pausing is free.
- `cite42_tracker_delete`: permanently delete a draft or paused tracker and its run history. Active trackers must be paused first, and deletion is rejected while a run is queued or running. Financial usage records remain available.
- `cite42_tracker_run`: queue one manual run of every saved prompt. Each prompt is billed as its own tool call at the normal rate, and completion sends the same current-results email as a scheduled run—even for a baseline or an unchanged result.
- `cite42_trackers`: list trackers, schedules, statuses, cost estimates, and last/next run times. Reading the list is free.
- `cite42_tracker_report`: read bounded stored run history with results, changes, status, sampled time, and costs (latest 8 by default, up to 20). Reading stored reports is free.

## Configuration

- `CITE42_API_KEY`: required for the local package. Your API key from [www.cite42.dev/app/keys](https://www.cite42.dev/app/keys).
- `CITE42_API_BASE`: optional. Defaults to `https://www.cite42.dev/api/v1`.

You can also pass these as CLI flags instead of environment variables:

```bash
npx -y @cite42/mcp --api-key=cite42_live_your_key_here --api-base=https://www.cite42.dev/api/v1
```

## Billing

Tool and workflow calls charge your Cite42 balance in USD. Tracker management and stored-history reads are free; every scheduled or manual tracker run bills one call per saved prompt at the normal rate. Activating or resuming a tracker requires explicit confirmation of the current maximum cost in USD per run and authorizes recurring billed calls until you pause it. Calls fail with a clear error if the API key is missing or your balance runs out. See [www.cite42.dev/pricing](https://www.cite42.dev/pricing).

## Troubleshooting

- **Server not listed after setup**: make sure you fully restarted the client (new terminal for CLI clients, full quit for desktop apps).
- **"No Cite42 account is linked to this sign-in"**: you signed in with a different account than the one you use at cite42.dev. In Claude Code run `claude mcp logout cite42`, then `claude mcp login cite42` and pick the same sign-in method as on the dashboard.
- **`command not found: npx`**: install Node.js 22.13+ from [nodejs.org](https://nodejs.org), then restart your terminal.
- **Tool calls fail with an auth error**: check the key was passed correctly (`CITE42_API_KEY`, no quotes or trailing spaces) and is active at [www.cite42.dev/app/keys](https://www.cite42.dev/app/keys).
- **Tool calls fail with an insufficient-balance error**: add funds at [www.cite42.dev/app](https://www.cite42.dev/app).

## Development

This repository is the source of the [`@cite42/mcp`](https://www.npmjs.com/package/@cite42/mcp) package on npm. It is a thin client: each tool calls the hosted Cite42 API, which runs the AI and data queries.

```bash
npm ci
npm run build
npm test            # unit tests
npm run test:stdio  # runs the built executable against a local fake API; no key, no paid calls
```

Report bugs in [GitHub issues](https://github.com/Cite42/mcp/issues) or email support@cite42.dev.

## Links

- Website: [Cite42: AI visibility and SEO data for AI agents](https://www.cite42.dev)
- API keys: [Create a Cite42 API key](https://www.cite42.dev/app/keys)
- Docs: [Cite42 API & MCP documentation](https://www.cite42.dev/docs)
- Pricing: [Cite42 pay-per-call pricing](https://www.cite42.dev/pricing)
- npm: [@cite42/mcp](https://www.npmjs.com/package/@cite42/mcp)

## USD billing

Every paid result carries a `cite42Billing` block with the amount charged and the remaining
Cite42 balance. Its `chargedUsd` and `remainingUsd` values are decimal strings in USD.
Credits are retired: since 0.8.0 the package no longer returns `cite42Credits`, and
`cite42_credits` answers exactly like `cite42_balance`.

`cite42_pricing` always returns the USD price table; an older `currency` argument is ignored.
REST clients can use `GET /v1/pricing?currency=USD`. Tracker activation still accepts the exact
integer `maxCostMicroPerRun` returned by the API; present its USD equivalent to users.

## Optional AI visibility recommendations

`cite42_rankings`, `cite42_compare`, `cite42_citations` and `cite42_sentiment` include a `metrics`
block. Show mention/citation percentages with their counts (for example, **66.7% — 2 of 3 checked
answers**). Sentiment percentages describe AI-estimated tone, not the percentage of positive answers.
Failed, empty and incomplete observations are excluded; no usable sample is unavailable, not zero.
Only comparable tracker runs provide automatic history. Each reported run includes `metrics` grouped
by primitive and brand/watched URL, with `current`, `previous`, `previousRunId`, and `changes`.
Each group states `models` and `methodologyVersion`. Its `comparison` is `comparable`, `baseline`
(no earlier run, or a new measurement baseline after an old-format run), or `unavailable`;
`comparisonReason` explains skipped comparisons. A successful run with unavailable comparison data
is not a failed run, and its email does not claim "no changes". Completed manual-run replays include
the same immediate predecessor as tracker reports.
Citation groups preserve the original watched URL; normalized identities are only used for matching.
Counts sum distinct prompts: four prompts × five surfaces can supply 20 answers. Comparisons require
the complete prompt/configuration set, methodology and complete coverage to match the preceding run.
Individual prompts remain small samples (at most five surfaces); percentage-point changes are withheld
below 10 answers per group in each run. This guardrail does not establish statistical significance.

`cite42_recommendations` is a separate, optional report. With no saved result, `url` alone runs a free
technical check (robots.txt crawler access, indexing, rendering) and suggests buyer questions, and `url`
with `query` first runs a citations check, priced like `cite42_citations`. Otherwise use one `requestId`
returned by an earlier call, a user-owned `trackerRunId`, or a structured `evidence` array. Pass `url` for the page
that should answer the prompt, or `context.domain` to look for a match in that site's sitemap, and
`query` to choose a prompt when the evidence covers several. Optional `context` also accepts brand,
audience and goal for this request only. The report fetches that page, its robots.txt and up to two
pages the AI surfaces cited, as returned HTML without JavaScript. Check `cite42_pricing` for the
current report price and obtain the user's agreement before running the add-on. It is charged only
when the report includes page-comparison recommendations backed by quotes from the inspected pages;
everything else is free.

For rankings evidence, provide `context.brand` to identify the tracked brand you want advice for.
Without it, the measurements remain available but the tool asks which brand to focus on for free;
it never guesses ownership or advises you to improve a competitor's offering. Comparison evidence
already identifies its target through `input.brand`.

Sources must be complete and no more than 30 days old, within 20 observations and 64KB. Supported
successful workflow steps can be reused. The tool does not inspect websites, retrieve host memory,
perform fresh research, recommend keywords, or activate paid tracking. Suggestions are labelled
inferred and do not establish website defects or causes. Tracker follow-up requires a cadence and
timezone choice plus separate activation approval. Identical completed retries are free for two
minutes; an in-flight duplicate is refused without another charge and can be retried shortly.
