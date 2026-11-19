import { localQuestions } from './fixtures.mjs';
import { realKnowledge, realQuestions } from './real-data.mjs';
export function createLocalRuntime(options = {}) {
  return {
    questions: [...localQuestions.filter(q => q.source === 'ai'), ...realQuestions].map(q => ({ ...q })),
    knowledge: realKnowledge.map(n => ({ ...n })),
    papers: [], attempts: [], wrongBook: [], reports: [], jobs: [], llmCalls: [],
    idempotency: new Map(), deviceSessions: new Map(), aiSettings: new Map(), composeStats: { success: 0, failure: 0 },
    usage: new Map(), generatedToday: 0,
    dataset: 'local-fixtures',
    llm: options.llm || null,
  };
}
export function checkQuota(runtime, deviceId, cost = 1) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${deviceId}:${today}`;
  const used = runtime.usage.get(key) || 0;
  if (used + cost > 20 || runtime.generatedToday + cost > 200) return false;
  runtime.usage.set(key, used + cost); runtime.generatedToday += cost; return true;
}
