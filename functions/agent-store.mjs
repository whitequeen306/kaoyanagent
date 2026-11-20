import { fail, uuid, nowIso } from './model.mjs';

const BASES = new Set(['薄弱', '一般', '扎实']);
const STAGES = new Set(['基础', '强化', '冲刺']);
const SOURCE_MODES = new Set(['real', 'ai', 'mixed']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const DETAIL_LEVELS = new Set(['concise', 'detailed']);

function text(value, max = 1000) {
  if (typeof value !== 'string' || value.length > max) fail('invalid_input');
  return value.trim();
}
function number(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) fail('invalid_input');
  return value;
}
function profileFrom(input) {
  return {
    subject: '数学二',
    exam_year: input.exam_year == null || input.exam_year === '' ? null : number(input.exam_year, 2026, 2100, 'exam_year'),
    target_score: input.target_score == null || input.target_score === '' ? null : number(input.target_score, 0, 150, 'target_score'),
    foundation: BASES.has(input.foundation) ? input.foundation : '一般',
    stage: STAGES.has(input.stage) ? input.stage : '基础',
    weekly_minutes: input.weekly_minutes == null || input.weekly_minutes === '' ? null : number(input.weekly_minutes, 30, 10080, 'weekly_minutes'),
    daily_minutes: input.daily_minutes == null || input.daily_minutes === '' ? null : number(input.daily_minutes, 10, 1440, 'daily_minutes'),
    weak_points: Array.isArray(input.weak_points) ? input.weak_points.map(item => text(item, 200)).filter(Boolean).slice(0, 20) : [],
    notes: input.notes == null ? '' : text(input.notes, 2000),
  };
}
function defaultPreferences() {
  return { source_mode: 'mixed', question_count: 6, difficulty: 'medium', detail_level: 'detailed', hint_first: true };
}
function preferencesFrom(input, current) {
  const next = { ...(current || defaultPreferences()), ...input };
  if (!SOURCE_MODES.has(next.source_mode) || !DIFFICULTIES.has(next.difficulty) || !DETAIL_LEVELS.has(next.detail_level)) fail('invalid_input');
  next.question_count = Math.round(number(next.question_count, 1, 30, 'question_count'));
  next.hint_first = Boolean(next.hint_first);
  return next;
}
export function getAgentState(runtime, deviceId) {
  let state = runtime.agentStates.get(deviceId);
  if (!state) {
    state = {
      profile: profileFrom({}), agent_summary: '', agent_summary_updated_at: null,
      preferences: defaultPreferences(), plans: [], conversations: [], tasks: [],
      created_at: nowIso(), updated_at: nowIso(),
    };
    runtime.agentStates.set(deviceId, state);
  }
  return state;
}
export function saveProfile(runtime, deviceId, input) {
  const state = getAgentState(runtime, deviceId);
  state.profile = profileFrom(input);
  state.updated_at = nowIso();
  return state.profile;
}
export function savePreferences(runtime, deviceId, input) {
  const state = getAgentState(runtime, deviceId);
  state.preferences = preferencesFrom(input, state.preferences);
  state.updated_at = nowIso();
  return state.preferences;
}
export function saveAgentSummary(runtime, deviceId, input) {
  const state = getAgentState(runtime, deviceId);
  state.agent_summary = text(input.summary || '', 4000);
  state.agent_summary_updated_at = nowIso();
  state.updated_at = nowIso();
  return state.agent_summary;
}
export function clearAgentSummary(runtime, deviceId) {
  return saveAgentSummary(runtime, deviceId, { summary: '' });
}
export function createStudyPlan(runtime, deviceId, input) {
  const state = getAgentState(runtime, deviceId);
  const items = Array.isArray(input.items) ? input.items.map(item => ({
    title: text(item.title || '', 300),
    action: item.action ? text(item.action, 1000) : '',
    minutes: item.minutes == null ? null : number(item.minutes, 5, 1440, 'minutes'),
    paper_id: item.paper_id || null,
  })).filter(item => item.title) : [];
  if (!items.length) fail('invalid_input');
  const plan = {
    id: uuid(), device_id: deviceId, title: text(input.title || '学习计划', 200),
    goal: text(input.goal || '', 2000), items, status: 'active',
    created_at: nowIso(), updated_at: nowIso(), source: input.source || 'agent',
  };
  state.plans.push(plan);
  state.updated_at = nowIso();
  return plan;
}
export function updateStudyPlan(runtime, deviceId, planId, input) {
  const state = getAgentState(runtime, deviceId);
  const plan = state.plans.find(item => item.id === planId);
  if (!plan) fail('not_found', 404);
  if (input.status !== undefined) {
    if (!['active', 'completed', 'archived'].includes(input.status)) fail('invalid_input');
    plan.status = input.status;
  }
  plan.updated_at = nowIso();
  return plan;
}
export function getConversation(runtime, deviceId, conversationId) {
  const state = getAgentState(runtime, deviceId);
  let conversation = state.conversations.find(item => item.id === conversationId);
  if (!conversation) {
    conversation = { id: uuid(), device_id: deviceId, title: '学习助手对话', messages: [], summary: null, created_at: nowIso(), updated_at: nowIso() };
    state.conversations.push(conversation);
  }
  return conversation;
}
export function appendMessages(conversation, messages) {
  conversation.messages.push(...messages);
  conversation.updated_at = nowIso();
}
export function createAgentTask(runtime, deviceId, input) {
  const state = getAgentState(runtime, deviceId);
  const task = {
    id: uuid(), device_id: deviceId, conversation_id: input.conversation_id || null,
    goal: text(input.goal || '', 2000), status: 'queued', stage: '理解需求',
    current_step: 0, steps: [], context_state: {}, result: null, error: null,
    created_at: nowIso(), updated_at: nowIso(),
  };
  state.tasks.push(task);
  return task;
}
