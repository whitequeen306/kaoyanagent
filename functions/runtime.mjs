import { localQuestions } from './fixtures.mjs';
import { realKnowledge, realQuestions } from './real-data.mjs';
import { cs408Knowledge, cs408Papers, cs408Questions } from './cs408-data.mjs';
import { normalizeAiQuestions } from './ai-question-pool.mjs';
import realQuestionHolds from './real-question-holds.json' with { type: 'json' };

const heldContent = new Set(realQuestionHolds.map(row => row.content_hash));
const utcDate = () => new Date().toISOString().slice(0, 10);
export function isHeldRealQuestion(question) {
  return question?.source === 'real' && heldContent.has(question.content_hash);
}
export const subjectOf = question => question?.subject || 'math2';

export function createLocalRuntime(options = {}) {
  const mathQuestions = [...localQuestions.filter(q => q.source === 'ai'), ...realQuestions]
    .map(q => ({ ...(isHeldRealQuestion(q) && q.status === 'published' ? { ...q, status: 'pending_review' } : q), subject: 'math2' }));
  return {
    questions: normalizeAiQuestions([...mathQuestions, ...cs408Questions.map(q => ({ ...q }))]),
    knowledge: realKnowledge.map(n => ({ ...n })),
    cs408Knowledge: cs408Knowledge.map(n => ({ ...n })),
    cs408Papers: cs408Papers.map(p => ({ ...p })),
    papers: [], attempts: [], wrongBook: [], repairCases: [], repairDaily: new Map(), repairSampling: new Map(), repairDailyDirty: false, repairSamplingDirty: false, reports: [], jobs: [], llmCalls: [], dailyQuestions: new Map(), dailySubmitQueues: new Map(),
    idempotency: new Map(), idempotencyInflight: new Map(), imageAssets: new Map(), deviceSessions: new Map(), aiSettings: new Map(), agentStates: new Map(), aiQuestionReservations: new Map(), composeStats: { success: 0, failure: 0 },
    dailyQuestionsDirty: false,
    usage: new Map(), generatedToday: 0, usageDate: utcDate(),
    dataset: 'local-fixtures',
    llm: options.llm || null,
    random: options.random || Math.random,
  };
}
function quotaDate(runtime) {
  const today = utcDate();
  if (runtime.usageDate !== today) {
    runtime.usage.clear();
    runtime.generatedToday = 0;
    runtime.usageDate = today;
  }
  return today;
}

export function checkQuota(runtime, deviceId, cost = 1) {
  const today = quotaDate(runtime);
  const key = `${deviceId}:${today}`;
  const used = runtime.usage.get(key) || 0;
  if (used + cost > 20 || runtime.generatedToday + cost > 200) return false;
  runtime.usage.set(key, used + cost); runtime.generatedToday += cost; return true;
}
