import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: ['src/stdio.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  dts: true,
  clean: true,
  // Keep the MCP server's reported version in lockstep with the npm package version.
  define: { __PKG_VERSION__: JSON.stringify(version) },
  // Force `.mjs` for ESM so the published `bin` (dist/stdio.mjs) resolves regardless of how
  // the consuming environment interprets `.js`.
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
});
