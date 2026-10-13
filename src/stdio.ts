#!/usr/bin/env node
/**
 * Cite42 MCP server — stdio entry point for Claude Desktop, Cursor, and other MCP clients.
 * Run via `npx -y @cite42/mcp@latest` with `CITE42_API_KEY` (and optional `CITE42_API_BASE`) set in
 * the client's MCP config. Tools forward to the hosted Cite42 REST API.
 */
import { resolveApiKey } from './client.js';
import { buildCite42Server } from './server.js';

// Injected at build time from package.json via tsup `define`.
declare const __PKG_VERSION__: string;

if (!resolveApiKey()) {
  console.error(
    '[@cite42/mcp] Missing API key. Set CITE42_API_KEY in your MCP client config (or pass ' +
      '--api-key=cite42_live_...). Get a key at https://www.cite42.dev/app/keys. Setup guide: ' +
      'https://www.npmjs.com/package/@cite42/mcp'
  );
  process.exit(1);
}

buildCite42Server(__PKG_VERSION__)
  .startStdio()
  .catch((error) => {
    console.error('[@cite42/mcp] Fatal error:', error);
    process.exit(1);
  });
