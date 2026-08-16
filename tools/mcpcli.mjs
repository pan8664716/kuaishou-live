import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import readline from 'node:readline';

const SERVER = '/Users/star/.npm/_npx/666793a7876f3860/node_modules/js-reverse-mcp/build/src/index.js';

const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
proc.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

const transport = new StdioClientTransport({
  command: 'node',
  args: [SERVER],
  stderr: 'pipe',
});
const client = new Client({ name: 'jsreverse-cli', version: '1.0.0' });
await client.connect(transport);
const tools = await client.listTools();
console.error('[info] connected, tools:', tools.tools.map(t => t.name).join(', '));

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch (e) { console.log(JSON.stringify({ ok: false, error: 'bad json' })); return; }
  try {
    const res = await client.callTool({ name: req.tool, arguments: req.args || {} });
    console.log(JSON.stringify(res));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
});
