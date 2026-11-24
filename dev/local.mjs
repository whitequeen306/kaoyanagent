import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const rawLine of fs.readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      process.env[match[1]] = process.env[match[1]] || value;
    }
  }
} catch {}
import { application, errorResponse } from '../functions/routes.mjs';
import { createLocalRuntime } from '../functions/runtime.mjs';
const runtime = createLocalRuntime();
const useSqlite = process.env.USE_SQLITE === '1' || !process.env.LOCAL_DATABASE_URL;
const { createPersistence } = useSqlite
  ? await import('./persist.mjs')
  : await import('./persist-postgres.mjs');
const persistence = createPersistence(runtime, useSqlite ? resolve(root, 'data', 'kaoyan.db') : process.env.LOCAL_DATABASE_URL);
await persistence.load();
console.log(`Local storage: ${useSqlite ? 'SQLite' : 'PostgreSQL'}`);
const handle = application(runtime);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8000);
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://127.0.0.1:5173';
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const corsHeaders = (requestOrigin) => {
  const headers = {
    'access-control-allow-headers': 'content-type, idempotency-key, x-device-id, x-device-token',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (allowedOrigin === '*' || requestOrigin === allowedOrigin) headers['access-control-allow-origin'] = allowedOrigin === '*' ? '*' : requestOrigin;
  return headers;
};
const server = http.createServer(async (req, res) => {
  let response;
  try {
    if (req.method === 'OPTIONS') {
      response = new Response(null, { status: 204 });
    } else {
      const url = `http://${req.headers.host || `${host}:${port}`}${req.url}`;
      const bytes = [];
      let requestBytes = 0;
      let tooLarge = false;
      for await (const chunk of req) {
        requestBytes += chunk.length;
        if (requestBytes <= MAX_REQUEST_BYTES) bytes.push(chunk);
        else tooLarge = true;
      }
      response = tooLarge
        ? Response.json({ ok: false, error: { code: 'payload_too_large' } }, { status: 413 })
        : await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(bytes) }));
    }
  } catch (error) {
    response = errorResponse(error);
  } finally {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) || runtime.dailyQuestionsDirty || runtime.repairDailyDirty || runtime.repairSamplingDirty) {
      await persistence.save();
      runtime.dailyQuestionsDirty = false;
      runtime.repairDailyDirty = false;
      runtime.repairSamplingDirty = false;
    }
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(req.headers.origin))) headers.set(name, value);
  res.writeHead(response.status, Object.fromEntries(headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, host, () => console.log(`Local backend: http://${host}:${port}/functions/v1/app/api/health`));
