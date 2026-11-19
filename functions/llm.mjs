// Server-side OpenAI-compatible client. Keys never reach the browser.
import { AppError } from './model.mjs';

function readEnvConfig() {
  const read = name => {
    if (typeof globalThis.Deno !== 'undefined') return globalThis.Deno.env.get(name);
    return globalThis.process?.env?.[name];
  };
  return {
    baseUrl: read('KAOYAN_LLM_BASE_URL'),
    apiKey: read('KAOYAN_LLM_API_KEY'),
    model: read('KAOYAN_LLM_MODEL'),
  };
}

export function llmConfigured() {
  const config = readEnvConfig();
  return Boolean(config.baseUrl && config.apiKey && config.model);
}

export async function chat(messages, { maxTokens = 8000, temperature = 0.3, timeoutMs = 180000, provider } = {}) {
  const config = provider
    ? {
        baseUrl: provider.base_url || provider.baseUrl,
        apiKey: provider.api_key || provider.apiKey,
        model: provider.model,
      }
    : readEnvConfig();
  if (!config.baseUrl || !config.apiKey || !config.model) throw new AppError('llm_not_configured', 503);
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  let response;
  try {
    response = await fetch(config.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError('llm_unreachable', 503);
  }
  if (!response.ok) {
    throw new AppError('llm_upstream_error', 502);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
