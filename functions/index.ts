// Local P1 entry. The deployed adapter must inject the platform database/storage
// without changing application routes or exposing secrets to the browser.
import { application, errorResponse } from './routes.mjs';
import { createLocalRuntime } from './runtime.mjs';

const handle = application(createLocalRuntime());
Deno.serve(async (request: Request) => {
  try { return await handle(request); }
  catch (error) { return errorResponse(error); }
});
