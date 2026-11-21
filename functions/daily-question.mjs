import { fail, nowIso, uuid } from './model.mjs';
import { providerFor } from './ai-settings.mjs';

const DAILY_HISTORY_DAYS = 7;
const MAX_AI_MESSAGES = 12;

function dailyQuestions(runtime) {
  runtime.dailyQuestions ||= new Map();
  return runtime.dailyQuestions;
}

export function dailyDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dailyKey(deviceId, date) {
  return `${deviceId}:${date}`;
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function questionCodes(question) {
  return new Set((question.knowledge || []).map(node => node.code).filter(Boolean));
}

function publishedQuestion(question) {
  return question && question.status === 'published' && !question.is_fixture && question.stem_latex && question.answer_latex;
}

function attemptRows(runtime, deviceId, questionId) {
  return runtime.attempts.filter(attempt => attempt.device_id === deviceId && attempt.question_id === questionId);
}

function conceptStats(runtime, deviceId, codes) {
  let score = 0;
  let max = 0;
  for (const attempt of runtime.attempts) {
    if (attempt.device_id !== deviceId || attempt.grading_status !== 'completed') continue;
    const question = runtime.questions.find(item => item.id === attempt.question_id);
    if (!question || ![...(questionCodes(question))].some(code => codes.has(code))) continue;
    score += attempt.score_x2;
    max += attempt.max_score_x2;
  }
  return max ? { score, max, rate: score / max } : null;
}

function scoreQuestion(runtime, deviceId, question, date, now) {
  const attempts = attemptRows(runtime, deviceId, question.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = attempts[0] || null;
  const wrong = runtime.wrongBook.find(item => item.device_id === deviceId && item.question_id === question.id);
  const due = Boolean(wrong?.next_review_at && Date.parse(wrong.next_review_at) <= now.getTime());
  const codes = questionCodes(question);
  const concepts = conceptStats(runtime, deviceId, codes);
  let score = 0;
  if (due) score += 120;
  if (wrong) score += 65 + Math.max(0, 5 - Number(wrong.mastery || 0)) * 9;
  if (!attempts.length) score += 52;
  if (latest) {
    const rate = latest.max_score_x2 ? latest.score_x2 / latest.max_score_x2 : 0;
    score += Math.round((1 - rate) * 45);
    if (latest.score_x2 < latest.max_score_x2) score += 32;
    if (latest.score_x2 === latest.max_score_x2) score -= 12;
  }
  if (concepts) score += Math.round((1 - concepts.rate) * 35);
  if (question.source === 'real') score += 4;
  if (question.difficulty === 'easy' && (wrong?.mastery ?? 5) <= 1) score += 6;
  if (question.difficulty === 'hard' && concepts?.rate >= 0.8) score += 4;

  let reason;
  if (due) reason = { code: 'due_review', text: '今天有一个到期复习的知识点，先把它重新做一遍。' };
  else if (wrong) reason = { code: 'weak_question', text: '这道题曾经答错过，今天用一道短练习把薄弱处补回来。' };
  else if (!attempts.length) reason = { code: 'new_question', text: '这个考点还没有留下作答记录，今天先建立一次掌握度基线。' };
  else if (concepts && concepts.rate < 0.7) reason = { code: 'weak_concept', text: '根据近期作答，这个知识点的得分率偏低，今天优先巩固它。' };
  else reason = { code: 'keep_warm', text: '今天用一道代表题保持手感，再看看解题步骤是否熟练。' };

  return { question, score, reason, tie: hash(`${deviceId}:${date}:${question.id}`) };
}

function recentQuestionIds(runtime, deviceId, date) {
  const threshold = new Date(`${date}T00:00:00+08:00`).getTime() - DAILY_HISTORY_DAYS * 86400000;
  return new Set([...dailyQuestions(runtime).values()]
    .filter(item => item.device_id === deviceId && item.date < date && Date.parse(`${item.date}T00:00:00+08:00`) >= threshold)
    .map(item => item.question_id));
}

function chooseQuestion(runtime, deviceId, date, now) {
  const candidates = runtime.questions.filter(publishedQuestion);
  if (!candidates.length) fail('insufficient_questions', 409);
  const recent = recentQuestionIds(runtime, deviceId, date);
  const fresh = candidates.filter(question => !recent.has(question.id));
  const pool = fresh.length ? fresh : candidates;
  return pool.map(question => scoreQuestion(runtime, deviceId, question, date, now))
    .sort((left, right) => right.score - left.score || left.tie - right.tie)[0];
}

function snapshotQuestion(question) {
  return JSON.parse(JSON.stringify(question));
}

export function getDailyQuestion(runtime, deviceId, date = dailyDate(), now = new Date()) {
  const map = dailyQuestions(runtime);
  const key = dailyKey(deviceId, date);
  let record = map.get(key);
  const paper = record?.paper_id ? runtime.papers.find(item => item.id === record.paper_id) : null;
  let question = record
    ? runtime.questions.find(item => item.id === record.question_id)
      || record.question_snapshot
      || paper?.items_json?.find(item => item.question_id === record.question_id)?.question
    : null;
  if (!record) {
    const selected = chooseQuestion(runtime, deviceId, date, now);
    record = {
      device_id: deviceId, date, question_id: selected.question.id,
      question_snapshot: snapshotQuestion(selected.question),
      reason: selected.reason, paper_id: null, ai_messages: [],
      created_at: nowIso(), updated_at: nowIso(),
    };
    map.set(key, record);
    runtime.dailyQuestionsDirty = true;
    question = selected.question;
  }
  if (!question) fail('state_conflict', 409);
  return { record, question, paper };
}

export function ensureDailyPaper(runtime, daily) {
  if (daily.paper) return daily.paper;
  const { record, question } = daily;
  if (!question) fail('not_found', 404);
  const paper = {
    id: uuid(), device_id: record.device_id, title: `每日一题 · ${record.date}`,
    mode: 'drill', source_mode: question.source, status: 'draft',
    items_json: [{ question_id: question.id, question, score_x2: question.score_x2 }],
    total_score_x2: question.score_x2,
    actual_ratio: { real: question.source === 'real' ? 1 : 0, ai: question.source === 'ai' ? 1 : 0 },
    adjustments: [], dataset: runtime.dataset, origin: 'daily',
    config_json: { origin: 'daily', daily_date: record.date },
    created_at: nowIso(), submitted_at: null,
  };
  runtime.papers.push(paper);
  record.paper_id = paper.id;
  record.updated_at = nowIso();
  daily.paper = paper;
  return paper;
}

function questionContext(question, attempt) {
  return JSON.stringify({
    question: question.stem_latex,
    type: question.qtype,
    options: question.options_json || [],
    user_answer: attempt?.answer_raw || '',
    correct_answer: question.answer_latex,
    existing_explanation: question.generator_meta_json?.approach_raw || '',
    solution_steps: question.generator_meta_json?.solution_steps || [],
  });
}

async function generateDailyAiReplyNow(runtime, deviceId, prompt) {
  const daily = getDailyQuestion(runtime, deviceId);
  const paper = daily.paper;
  if (!paper || paper.status !== 'submitted') fail('state_conflict', 409);
  const provider = providerFor(runtime, deviceId);
  if (!provider) fail('llm_not_configured', 503);
  const attempt = runtime.attempts.find(item => item.paper_instance_id === paper.id && item.question_id === daily.question.id);
  const userPrompt = String(prompt || '').trim().slice(0, 1000)
    || '请结合我的这次作答，用适合考研数学二复习的方式讲解这道题，并指出我下一步最该注意什么。';
  const history = Array.isArray(daily.record.ai_messages) ? daily.record.ai_messages.slice(-MAX_AI_MESSAGES) : [];
  const messages = [
    { role: 'system', content: '你是考研数学二辅导老师。只根据题目、参考答案、已有解析和用户作答回答。先指出结论，再给出简洁步骤和一个可执行的复习提醒。用户追问时直接回答，不能编造题目中没有的条件。使用中文，数学公式可用 LaTeX。' },
    { role: 'user', content: `这是每日一题及本次作答上下文：${questionContext(daily.question, attempt)}` },
    ...history,
    { role: 'user', content: userPrompt },
  ];
  const reply = await provider(messages, { maxTokens: 1200, temperature: 0.25 });
  const text = String(reply || '').trim();
  if (!text) fail('llm_empty_response', 502);
  daily.record.ai_messages = [...history, { role: 'user', content: userPrompt }, { role: 'assistant', content: text.slice(0, 5000) }];
  daily.record.updated_at = nowIso();
  return daily.record.ai_messages;
}

export async function generateDailyAiReply(runtime, deviceId, prompt = '') {
  const key = `${deviceId}:${dailyDate()}`;
  const queues = runtime.dailyAiQueues ||= new Map();
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => generateDailyAiReplyNow(runtime, deviceId, prompt));
  queues.set(key, current);
  try {
    return await current;
  } finally {
    if (queues.get(key) === current) queues.delete(key);
  }
}
