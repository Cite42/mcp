import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const stateDirectory = path.join(packageDirectory, '.inspector');
const catalogPath = path.join(stateDirectory, 'mcp.json');

await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
const stdioEnvironment = {
  // Replace this in the Inspector for account-bound calls. Discovery needs no valid key.
  CITE42_API_KEY: 'cite42_live_inspector_placeholder',
  CITE42_API_BASE: 'http://127.0.0.1:3030/api/v1',
};
const catalog = {
  mcpServers: {
    'cite42-local-build': {
      type: 'stdio',
      command: process.execPath,
      args: [path.join(packageDirectory, 'dist/stdio.mjs')],
      env: stdioEnvironment,
    },
    'cite42-published-npm': {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@cite42/mcp@latest'],
      env: stdioEnvironment,
    },
    'cite42-local-oauth': {
      type: 'http',
      url: 'http://127.0.0.1:3030/mcp',
    },
  },
};

try {
  // Keep saved keys and server settings when restarting the inspector.
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}

console.log('Starting MCP Inspector with three Cite42 targets. Local app: 127.0.0.1:3030.');
const inspector = spawn('npx', [
  '-y', '@modelcontextprotocol/inspector@2.6.0', '--web', '--catalog', catalogPath,
], {
  cwd: packageDirectory,
  stdio: 'inherit',
  env: {
    ...process.env,
    MCP_STORAGE_DIR: stateDirectory,
    MCP_INSPECTOR_SECRET_STORE: 'file',
    MCP_INSPECTOR_SECRET_FILE: path.join(stateDirectory, 'secrets.json'),
  },
});

inspector.on('error', (error) => {
  console.error(`Could not start MCP Inspector: ${error.message}`);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => inspector.kill(signal));
}
inspector.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
