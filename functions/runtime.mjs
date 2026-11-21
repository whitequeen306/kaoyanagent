import { localQuestions } from './fixtures.mjs';
import { realKnowledge, realQuestions } from './real-data.mjs';
import { normalizeAiQuestions } from './ai-question-pool.mjs';
export function createLocalRuntime(options = {}) {
  return {
    questions: normalizeAiQuestions([...localQuestions.filter(q => q.source === 'ai'), ...realQuestions].map(q => ({ ...q }))),
    knowledge: realKnowledge.map(n => ({ ...n })),
    papers: [], attempts: [], wrongBook: [], reports: [], jobs: [], llmCalls: [], dailyQuestions: new Map(),
    idempotency: new Map(), idempotencyInflight: new Map(), deviceSessions: new Map(), aiSettings: new Map(), agentStates: new Map(), aiQuestionReservations: new Map(), composeStats: { success: 0, failure: 0 },
    dailyQuestionsDirty: false,
    usage: new Map(), generatedToday: 0,
    dataset: 'local-fixtures',
    llm: options.llm || null,
    random: options.random || Math.random,
  };
}
export function checkQuota(runtime, deviceId, cost = 1) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${deviceId}:${today}`;
  const used = runtime.usage.get(key) || 0;
  if (used + cost > 20 || runtime.generatedToday + cost > 200) return false;
  runtime.usage.set(key, used + cost); runtime.generatedToday += cost; return true;
}
