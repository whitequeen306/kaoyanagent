import { fail, nowIso } from './model.mjs';
import { providerFor } from './ai-settings.mjs';
import { cs408Metrics, listCs408History } from './cs408.mjs';

const STATE_SUFFIX = ':cs408';
const STAGES = new Set(['基础', '强化', '冲刺']);
const FOUNDATIONS = new Set(['薄弱', '一般', '扎实']);

function stateKey(deviceId) {
  return `${deviceId}${STATE_SUFFIX}`;
}

function defaultProfile() {
  return {
    subject: '408',
    exam_year: 2027,
    target_score: 120,
    foundation: '一般',
    stage: '强化',
    daily_minutes: 120,
    weak_points: [],
    notes: '',
  };
}

function stateFor(runtime, deviceId) {
  runtime.agentStates ||= new Map();
  const key = stateKey(deviceId);
  let state = runtime.agentStates.get(key);
  if (!state || state.subject !== 'cs408') {
    state = {
      subject: 'cs408', device_id: key, profile: defaultProfile(), messages: [],
      created_at: nowIso(), updated_at: nowIso(),
    };
    runtime.agentStates.set(key, state);
  }
  return state;
}

function profileFrom(input, current) {
  const profile = { ...defaultProfile(), ...current };
  if (input.exam_year != null && input.exam_year !== '') {
    const year = Number(input.exam_year);
    if (!Number.isFinite(year) || year < 2026 || year > 2100) fail('invalid_input');
    profile.exam_year = Math.round(year);
  }
  if (input.target_score != null && input.target_score !== '') {
    const score = Number(input.target_score);
    if (!Number.isFinite(score) || score < 0 || score > 150) fail('invalid_input');
    profile.target_score = Math.round(score);
  }
  if (input.daily_minutes != null && input.daily_minutes !== '') {
    const minutes = Number(input.daily_minutes);
    if (!Number.isFinite(minutes) || minutes < 10 || minutes > 1440) fail('invalid_input');
    profile.daily_minutes = Math.round(minutes);
  }
  if (FOUNDATIONS.has(input.foundation)) profile.foundation = input.foundation;
  if (STAGES.has(input.stage)) profile.stage = input.stage;
  if (Array.isArray(input.weak_points)) {
    profile.weak_points = input.weak_points.filter(item => typeof item === 'string' && item.trim()).slice(0, 20).map(item => item.trim().slice(0, 200));
  }
  if (typeof input.notes === 'string') profile.notes = input.notes.slice(0, 2000);
  return profile;
}

export function publicCs408Agent(runtime, deviceId) {
  const state = stateFor(runtime, deviceId);
  return {
    profile: state.profile,
    messages: state.messages.slice(-80),
    configured: Boolean(runtime.llm || providerFor(runtime, deviceId)),
  };
}

export function saveCs408Profile(runtime, deviceId, input) {
  const state = stateFor(runtime, deviceId);
  state.profile = profileFrom(input, state.profile);
  state.updated_at = nowIso();
  return state.profile;
}

function contextSnapshot(runtime, deviceId) {
  const state = stateFor(runtime, deviceId);
  const history = listCs408History(runtime, deviceId).slice(0, 6);
  const metrics = cs408Metrics(runtime, deviceId);
  const wrong = runtime.wrongBook
    .filter(entry => entry.device_id === deviceId)
    .map(entry => runtime.questions.find(question => question.id === entry.question_id))
    .filter(question => question?.subject === 'cs408')
    .slice(0, 8)
    .map(question => ({
      label: question.year ? `${question.year} 年第 ${question.number} 题` : 'AI 变式',
      chapters: (question.knowledge || []).map(node => runtime.cs408Knowledge.find(item => item.code === node.code)?.name || node.code),
      wrong_at: null,
    }));
  const chapters = runtime.cs408Knowledge.filter(node => node.level === 2).map(node => node.name);
  return {
    profile: state.profile,
    history: history.map(item => ({
      title: item.title, status: item.status, questions: item.questions,
      score_rate_bp: item.score_rate_bp, origin: item.origin,
    })),
    metrics: {
      papers: metrics.papers, submitted: metrics.submitted, exam_years_done: metrics.exam_years_done,
      practice_papers: metrics.practice_papers, repair_papers: metrics.repair_papers,
      single_attempts: metrics.single_attempts, wrong_count: metrics.wrong_count,
      score_rate_bp: metrics.score_rate_bp,
      weak_chapters: metrics.chapters.slice(0, 6).map(chapter => ({
        name: chapter.name, attempts: chapter.attempts, correct: chapter.correct,
        score_rate_bp: chapter.score_rate_bp,
      })),
    },
    wrong: wrong,
    syllabus: chapters,
  };
}

export async function cs408AgentReply(runtime, deviceId, input) {
  const message = String(input.message || '').trim();
  if (!message || message.length > 2000) fail('invalid_input');
  const state = stateFor(runtime, deviceId);
  const provider = providerFor(runtime, deviceId);
  if (!provider) fail('llm_not_configured', 409);
  const context = contextSnapshot(runtime, deviceId);
  const system = `你是题脉的考研 408 学习助手。你要基于用户档案、真实试卷记录、错题和章节薄弱点，给出具体、可执行的 408 学习建议。
规则：
1. 只使用下面给出的真实数据；没有数据就明确说没有，不要编造题目、分数或错题。
2. 408 包含数据结构、计算机组成原理、操作系统、计算机网络四门课；计划要区分科目。
3. 回答优先给下一步行动：今天练什么、练多少、先看哪一章、怎么复盘。
4. 不要声称已经生成试卷或修改数据；你只能给建议。
5. 不要输出内部 ID、哈希或数据库字段。
6. 回复用中文，简洁分段；代码用代码块包裹。
7. 用户档案是事实；下面的统计是当前设备的真实汇总。
当前 408 数据：
${JSON.stringify(context, null, 2)}`;
  const history = state.messages.slice(-12).map(item => ({ role: item.role, content: item.content }));
  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: message },
  ];
  const reply = await provider(messages, { maxTokens: 2000, temperature: 0.4, timeoutMs: 120000 });
  const content = String(reply || '').trim();
  if (!content) fail('llm_empty_response', 502);
  const now = nowIso();
  state.messages.push({ role: 'user', content: message, created_at: now });
  state.messages.push({ role: 'assistant', content: content, created_at: nowIso() });
  state.messages = state.messages.slice(-80);
  state.updated_at = nowIso();
  return { reply: content, profile: state.profile, messages: state.messages.slice(-80) };
}

export function clearCs408Agent(runtime, deviceId) {
  const state = stateFor(runtime, deviceId);
  state.messages = [];
  state.updated_at = nowIso();
  return publicCs408Agent(runtime, deviceId);
}
