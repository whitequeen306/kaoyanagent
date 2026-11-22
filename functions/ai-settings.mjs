import { AppError, fail, nowIso } from './model.mjs';
import { chat, defaultLlmConfig } from './llm.mjs';
import { checkQuota } from './runtime.mjs';

export function settingsFor(runtime, deviceId) {
  return runtime.aiSettings?.get(deviceId) || null;
}

export function publicAiSettings(settings) {
  if (!settings) {
    const defaultConfig = defaultLlmConfig();
    return { configured: Boolean(defaultConfig), base_url: '', model: defaultConfig?.model || '', has_key: false, key_hint: '' };
  }
  return {
    configured: true,
    base_url: settings.base_url,
    model: settings.model,
    has_key: Boolean(settings.api_key),
    key_hint: settings.api_key ? `••••${settings.api_key.slice(-4)}` : '',
  };
}

export function providerFor(runtime, deviceId, { countPracticeCall = false } = {}) {
  const injected = runtime.llm;
  const settings = settingsFor(runtime, deviceId);
  const defaultConfig = injected || settings ? null : defaultLlmConfig();
  if (!injected && !settings && !defaultConfig) return null;
  return async (messages, options) => {
    if (!defaultConfig && countPracticeCall && !checkQuota(runtime, deviceId)) fail('quota_exceeded', 429);
    if (injected) return injected(messages, options);
    return chat(messages, { ...options, provider: settings || defaultConfig });
  };
}

export async function testProvider(settings) {
  const started = Date.now();
  const reply = await chat([{ role: 'user', content: '只回复 OK' }], {
    maxTokens: 128, temperature: 0, timeoutMs: 25000, provider: settings,
  });
  if (!String(reply).trim()) throw new AppError('llm_empty_response', 502);
  return { latency_ms: Date.now() - started, reply: String(reply).trim().slice(0, 80) };
}

export async function saveAiSettings(runtime, deviceId, input, existing) {
  let baseUrl = String(input.base_url || '').trim().replace(/\/+$/, '');
  baseUrl = baseUrl.replace(/\/chat\/completions$/i, '');
  const model = String(input.model || '').trim();
  const apiKey = String(input.api_key || '').trim() || existing?.api_key || '';
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl) || baseUrl.length > 500) fail('invalid_input');
  if (!apiKey || apiKey.length > 500 || !model || model.length > 200) fail('invalid_input');
  const settings = { device_id: deviceId, base_url: baseUrl, api_key: apiKey, model, updated_at: nowIso() };
  const test = await testProvider(settings);
  runtime.aiSettings.set(deviceId, settings);
  return { settings: publicAiSettings(settings), latency_ms: test.latency_ms };
}
