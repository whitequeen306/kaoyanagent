import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of fs.readFileSync(resolve(root, '.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = process.env[match[1]] || match[2];
  }
} catch {}
import { application, errorResponse } from '../functions/routes.mjs';
import { createLocalRuntime } from '../functions/runtime.mjs';
const runtime = createLocalRuntime();
const { createPersistence } = process.env.LOCAL_DATABASE_URL
  ? await import('./persist-postgres.mjs')
  : await import('./persist.mjs');
const persistence = createPersistence(runtime, process.env.LOCAL_DATABASE_URL || resolve(root, 'data', 'kaoyan.db'));
await persistence.load();
console.log(`Local storage: ${process.env.LOCAL_DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`);
const handle = application(runtime);
const server = http.createServer(async (req, res) => {
  let response;
  try {
    const url = `http://127.0.0.1:8000${req.url}`;
    const bytes = [];
    for await (const chunk of req) bytes.push(chunk);
    response = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(bytes) }));
  } catch (error) {
    response = errorResponse(error);
  } finally {
    if (req.method !== 'GET') await persistence.save();
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(8000, '127.0.0.1', () => console.log('Local backend: http://127.0.0.1:8000/functions/v1/app/api/health'));
