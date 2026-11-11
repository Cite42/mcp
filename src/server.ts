/**
 * Cite42 MCP server construction, shared by the stdio entry point (stdio.ts) and the protocol
 * tests. Keeping the tool registry here means a test failure — not a customer's MCP client — is
 * what catches a tool that was renamed, dropped, or wired to the wrong handler.
 */
import { MCPServer } from '@mastra/mcp';
import {
  aivBalance,
  aivPricing,
  aivUsage,
  aivSearch,
  aivRankings,
  aivCompare,
  aivCitations,
  aivSentiment,
  aivRecommendations,
  aivKeywords,
  aivKeywordsBatch,
  aivKeywordRankings,
  aivTrends,
  aivRedditTrends,
  aivYoutubeTrends,
  aivFindContentOpportunities,
  aivAnalyzeTopicDemand,
  aivMapAiPrompts,
  aivAnalyzeCompetitorContent,
  aivFindAiCitationGaps,
  aivGenerateContentBrief,
  aivTrackerCreate,
  aivTrackerUpdate,
  aivTrackerActivate,
  aivTrackerPause,
  aivTrackerDelete,
  aivTrackerRun,
  aivTrackers,
  aivTrackerReport,
} from './tools.js';

export const CITE42_TOOLS = {
  cite42_balance: aivBalance,
  cite42_pricing: aivPricing,
  cite42_usage: aivUsage,
  cite42_search: aivSearch,
  cite42_rankings: aivRankings,
  cite42_compare: aivCompare,
  cite42_citations: aivCitations,
  cite42_sentiment: aivSentiment,
  cite42_recommendations: aivRecommendations,
  cite42_keywords: aivKeywords,
  cite42_keywords_batch: aivKeywordsBatch,
  cite42_keyword_rankings: aivKeywordRankings,
  cite42_trends: aivTrends,
  cite42_reddit_trends: aivRedditTrends,
  cite42_youtube_trends: aivYoutubeTrends,
  cite42_find_content_opportunities: aivFindContentOpportunities,
  cite42_analyze_topic_demand: aivAnalyzeTopicDemand,
  cite42_map_ai_prompts: aivMapAiPrompts,
  cite42_analyze_competitor_content: aivAnalyzeCompetitorContent,
  cite42_find_ai_citation_gaps: aivFindAiCitationGaps,
  cite42_generate_content_brief: aivGenerateContentBrief,
  cite42_tracker_create: aivTrackerCreate,
  cite42_tracker_update: aivTrackerUpdate,
  cite42_tracker_activate: aivTrackerActivate,
  cite42_tracker_pause: aivTrackerPause,
  cite42_tracker_delete: aivTrackerDelete,
  cite42_tracker_run: aivTrackerRun,
  cite42_trackers: aivTrackers,
  cite42_tracker_report: aivTrackerReport,
} as const;

/**
 * Sent once at initialize, so an agent knows what Cite42 measures before it reads the tools: above
 * all that ChatGPT itself and Google AI Overviews are read from the real interfaces. Mirrors
 * CITE42_MCP_INSTRUCTIONS in apps/web/src/app/mcp/route.ts.
 */
export const CITE42_MCP_INSTRUCTIONS =
  'Cite42 measures how AI answers mention brands and which sources they cite. ChatGPT itself is read ' +
  'from its web interface (models: chatgpt_app) and Google AI Overviews from live Google results; ' +
  'OpenAI (chatgpt), Claude, Gemini and Perplexity are queried through their official APIs with web ' +
  'search. Each result\'s measurement block states how every surface was reached. Cite42 also returns ' +
  'Google rankings, keyword volume, Google Trends, Reddit and YouTube data, and runs daily, weekly or monthly ' +
  'trackers. Calls are billed per use in USD from a prepaid balance, failed calls are free, and ' +
  'cite42_pricing lists every price for free.';

export function buildCite42Server(version: string): MCPServer {
  return new MCPServer({
    id: 'cite42',
    name: 'Cite42',
    version,
    description: 'AI market data API: AI search, citations, SEO keywords, trends, and workflows.',
    instructions: CITE42_MCP_INSTRUCTIONS,
    tools: CITE42_TOOLS,
  });
}
