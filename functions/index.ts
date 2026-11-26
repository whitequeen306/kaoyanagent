// Local P1 entry. The deployed adapter must inject the platform database/storage
// without changing application routes or exposing secrets to the browser.
import { application, errorResponse } from './routes.mjs';
import { createLocalRuntime } from './runtime.mjs';
import { startJobRunner } from './job-runner.mjs';

const runtime = createLocalRuntime();
// 后台推进 AI 任务，页面关闭后仍继续；无定时能力的运行环境由前端轮询兜底。
startJobRunner(runtime);
const handle = application(runtime);
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
class PayloadTooLarge extends Error {}
function limitedRequest(request: Request) {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') return request;
  let total = 0;
  const body = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > MAX_REQUEST_BYTES) throw new PayloadTooLarge();
      controller.enqueue(chunk);
    },
  }));
  return new Request(request, { body });
}
Deno.serve(async (request: Request) => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return Response.json({ ok: false, error: { code: 'payload_too_large' } }, { status: 413 });
  try { return await handle(limitedRequest(request)); }
  catch (error) {
    if (error instanceof PayloadTooLarge) return Response.json({ ok: false, error: { code: 'payload_too_large' } }, { status: 413 });
    return errorResponse(error);
  }
});
