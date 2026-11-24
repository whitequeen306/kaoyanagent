import { nowIso, uuid } from './model.mjs';
import { recordReviewOutcome } from './review.mjs';

const PASS_TARGET = 5;
const MAX_VARIANTS = 15;
const DAY_MS = 86400000;
const DAILY_TARGET = 4;

function todayInShanghai() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function tomorrowStart() {
  return new Date(Date.parse(`${todayInShanghai()}T00:00:00+08:00`) + DAY_MS).toISOString();
}

function dateValue(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysSince(date, value) {
  if (!value) return null;
  const diff = Date.parse(`${date}T00:00:00+08:00`) - Date.parse(String(value).slice(0, 10));
  return Math.max(0, Math.floor(diff / DAY_MS));
}

function ensureFields(repair) {
  repair.selection_count ||= 0;
  repair.last_selected_at ||= null;
  repair.last_epoch ||= 0;
  repair.last_result ||= null;
  repair.repair_passes ||= 0;
  repair.repair_variants_done ||= 0;
  repair.next_repair_at ||= null;
  repair.round_history ||= [];
  return repair;
}

function mathQuestion(runtime, questionId) {
  const question = runtime.questions.find(item => item.id === questionId);
  return question && (question.subject || 'math2') === 'math2' ? question : null;
}

export function ensureRepairCases(deviceId, runtime) {
  runtime.repairCases ||= [];
  const existing = new Set(runtime.repairCases.filter(item => item.device_id === deviceId).map(item => item.question_id));
  for (const wrong of runtime.wrongBook.filter(item => item.device_id === deviceId)) {
    if (!mathQuestion(runtime, wrong.question_id)) continue;
    if (existing.has(wrong.question_id)) continue;
    existing.add(wrong.question_id);
    runtime.repairCases.push(ensureFields({
      id: uuid(), device_id: deviceId, question_id: wrong.question_id,
      status: 'new', diagnosis: null, job_id: null, paper_id: null,
      created_at: nowIso(), updated_at: nowIso(), completed_at: null,
    }));
  }
  return runtime.repairCases.filter(item => item.device_id === deviceId && mathQuestion(runtime, item.question_id)).map(ensureFields);
}

export function findRepairCase(deviceId, runtime, questionId) {
  ensureRepairCases(deviceId, runtime);
  return runtime.repairCases.find(item => item.device_id === deviceId && item.question_id === questionId) || null;
}

export function updateRepairCase(runtime, repair, patch) {
  Object.assign(ensureFields(repair), patch, { updated_at: nowIso() });
  return repair;
}

function wrongAttempt(runtime, wrong) {
  if (wrong?.attempt_id) return runtime.attempts.find(item => item.id === wrong.attempt_id) || null;
  if (wrong?.daily_date) {
    const daily = runtime.dailyQuestions.get(`${wrong.device_id}:${wrong.daily_date}`);
    if (daily?.judgment) return {
      answer_raw: daily.answer_raw || daily.judgment.answer_raw || '',
      feedback: daily.judgment.feedback || '',
      error_tags_json: daily.judgment.correct === false ? ['daily_wrong'] : [],
      created_at: daily.judgment.created_at || `${daily.date}T00:00:00+08:00`,
    };
  }
  return null;
}

function paperStats(runtime, paper, deviceId) {
  if (!paper) return { total: 0, answered: 0, correct: 0, rate_bp: null, mastered: false, pending: false };
  const ids = new Set(paper.items_json.map(item => item.question_id));
  const attempts = runtime.attempts.filter(item => item.device_id === deviceId
    && item.paper_instance_id === paper.id && ids.has(item.question_id));
  const total = ids.size;
  const correct = attempts.filter(item => item.score_x2 === item.max_score_x2).length;
  return {
    total, answered: attempts.length, correct,
    rate_bp: paper.status === 'submitted' && total ? Math.round(correct * 10000 / total) : null,
    mastered: paper.status === 'submitted' && total > 0 && correct === total,
    pending: paper.status !== 'submitted',
  };
}

export function repairCaseView(repair, runtime, deviceId) {
  ensureFields(repair);
  const wrong = runtime.wrongBook.find(item => item.device_id === deviceId && item.question_id === repair.question_id) || null;
  const daily = wrong?.daily_date ? runtime.dailyQuestions.get(`${deviceId}:${wrong.daily_date}`) : null;
  const question = daily?.question_snapshot || runtime.questions.find(item => item.id === repair.question_id) || null;
  const attempt = wrongAttempt(runtime, wrong);
  const paper = repair.paper_id ? runtime.papers.find(item => item.id === repair.paper_id) || null : null;
  const job = repair.job_id ? runtime.jobs.find(item => item.id === repair.job_id) : null;
  const stats = paperStats(runtime, paper, deviceId);
  let status = repair.status;
  if (repair.repair_passes >= PASS_TARGET) status = 'completed';
  else if (job && !['succeeded', 'failed'].includes(job.status)) status = 'generating';
  else if (job?.status === 'failed') status = 'failed';
  else if (paper?.status === 'draft') status = 'ready';
  else if (paper?.status === 'submitted') status = repair.last_result === 'passed' ? 'passed' : 'needs_retry';
  else if (status === 'generating' && !job) status = 'new';
  else if (status === 'completed' && repair.repair_passes < PASS_TARGET) status = 'passed';
  return {
    ...repair, status, question, wrong_answer: attempt?.answer_raw || '',
    error_tags: attempt?.error_tags_json || [], variant_stats: stats,
    paper_status: paper?.status || null, paper_title: paper?.title || null,
    job_stage: job?.stage || null, job_detail: job?.detail || null,
    job_progress: job?.progress ?? null,
  };
}

export function listRepairCases(deviceId, runtime) {
  const cases = ensureRepairCases(deviceId, runtime).map(item => repairCaseView(item, runtime, deviceId));
  const rank = { needs_retry: 0, ready: 1, failed: 2, generating: 3, passed: 4, new: 5, completed: 6 };
  return cases.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    || String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function syncRepairForPaper(runtime, paper) {
  const repair = runtime.repairCases?.find(item => item.paper_id === paper.id || item.job_id === paper.config_json?.repair_job_id);
  if (!repair) return;
  ensureFields(repair);
  const attempts = runtime.attempts.filter(item => item.paper_instance_id === paper.id);
  const allCorrect = attempts.length > 0 && attempts.every(item => item.score_x2 === item.max_score_x2);
  if (!allCorrect) {
    updateRepairCase(runtime, repair, {
      paper_id: paper.id, status: 'needs_retry', last_result: 'failed',
      next_repair_at: null,
    });
    return;
  }
  const alreadyCounted = repair.round_history.some(round => round.paper_id === paper.id);
  if (!alreadyCounted) {
    const passes = Math.min(PASS_TARGET, repair.repair_passes + 1);
    const variantsDone = Math.min(MAX_VARIANTS, repair.repair_variants_done + paper.items_json.length);
    repair.round_history.push({
      paper_id: paper.id, passed_at: nowIso(), variants: paper.items_json.length,
      score_x2: paper.total_score_x2,
    });
    updateRepairCase(runtime, repair, {
      paper_id: paper.id, status: passes >= PASS_TARGET ? 'completed' : 'passed',
      last_result: 'passed', repair_passes: passes, repair_variants_done: variantsDone,
      next_repair_at: passes >= PASS_TARGET ? null : tomorrowStart(),
      completed_at: passes >= PASS_TARGET ? nowIso() : null,
    });
    recordReviewOutcome(runtime, paper.device_id, repair.question_id, true, {});
  } else {
    updateRepairCase(runtime, repair, { paper_id: paper.id });
  }
}

function selectionWeight(repair, runtime, epoch, today) {
  const days = daysSince(today, repair.last_selected_at);
  const recency = days == null ? 1 : 0.65 + 0.35 * (1 - Math.exp(-days / 5));
  const countPenalty = 1 / (1 + 0.45 * Math.max(0, repair.selection_count - 1));
  const coverage = repair.last_epoch === epoch ? 0.45 : 1.6;
  const outcome = repair.last_result === 'failed' ? 1.4 : repair.last_result === 'passed' ? 0.75 : 1;
  let due = 1;
  if (repair.next_repair_at) {
    const dueAt = dateValue(repair.next_repair_at);
    const now = Date.now();
    due = dueAt < Date.parse(`${today}T00:00:00+08:00`) ? 1.5 : dueAt <= now + DAY_MS ? 1.2 : 0.7;
  }
  const progress = 1 - 0.06 * repair.repair_passes;
  return Math.max(0.01, recency * countPenalty * coverage * outcome * due * progress);
}

function weightedSample(items, count, runtime, epoch, today) {
  const pool = [...items];
  const picked = [];
  while (picked.length < count && pool.length) {
    const weights = pool.map(item => selectionWeight(item, runtime, epoch, today));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = (runtime.random || Math.random)() * total;
    let index = 0;
    while (index < pool.length - 1 && cursor > weights[index]) {
      cursor -= weights[index];
      index += 1;
    }
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function activeRepairCases(deviceId, runtime, date) {
  const wrongIds = new Set(runtime.wrongBook.filter(item => item.device_id === deviceId).map(item => item.question_id));
  return runtime.repairCases
    .filter(item => item.device_id === deviceId && mathQuestion(runtime, item.question_id))
    .map(ensureFields)
    .filter(item => wrongIds.has(item.question_id)
      && item.repair_passes < PASS_TARGET
      && (!item.next_repair_at || dateValue(item.next_repair_at) <= Date.now()));
}

export function replaceDailyRepair(deviceId, runtime, questionId) {
  const date = todayInShanghai();
  const key = `${deviceId}:${date}`;
  const record = runtime.repairDaily.get(key);
  if (!record || !record.question_ids.includes(questionId)) return null;
  const active = activeRepairCases(deviceId, runtime, date);
  const candidates = active.filter(item => item.question_id !== questionId && !record.question_ids.includes(item.question_id));
  if (!candidates.length) return false;
  runtime.repairSampling ||= new Map();
  const state = runtime.repairSampling.get(deviceId) || { device_id: deviceId, epoch: record.epoch || 1 };
  const [replacement] = weightedSample(candidates, 1, runtime, state.epoch, date);
  if (!replacement) return false;
  updateRepairCase(runtime, replacement, {
    selection_count: replacement.selection_count + 1,
    last_selected_at: date,
    last_epoch: state.epoch,
  });
  record.question_ids = record.question_ids.map(id => id === questionId ? replacement.question_id : id);
  record.updated_at = nowIso();
  runtime.repairSampling.set(deviceId, state);
  runtime.repairDailyDirty = true;
  runtime.repairSamplingDirty = true;
  return true;
}

export function getDailyRepair(deviceId, runtime) {
  ensureRepairCases(deviceId, runtime);
  const date = todayInShanghai();
  const key = `${deviceId}:${date}`;
  const cases = runtime.repairCases.filter(item => item.device_id === deviceId && mathQuestion(runtime, item.question_id)).map(ensureFields);
  const wrongIds = new Set(runtime.wrongBook.filter(item => item.device_id === deviceId).map(item => item.question_id));
  const active = cases.filter(item => wrongIds.has(item.question_id)
    && item.repair_passes < PASS_TARGET
    && (!item.next_repair_at || dateValue(item.next_repair_at) <= Date.now()));
  let record = runtime.repairDaily.get(key);
  if (active.length && (!record || record.question_ids.length < DAILY_TARGET)) {
    runtime.repairSampling ||= new Map();
    const state = runtime.repairSampling.get(deviceId) || { device_id: deviceId, epoch: 1 };
    if (active.every(item => item.last_epoch === state.epoch)) {
      state.epoch += 1;
      runtime.repairSamplingDirty = true;
    }
    runtime.repairSampling.set(deviceId, state);
    const selectedIds = new Set(record?.question_ids || []);
    const candidates = active.filter(item => !selectedIds.has(item.question_id));
    const need = Math.min(candidates.length, DAILY_TARGET - (record?.question_ids.length || 0));
    const picked = weightedSample(candidates, need, runtime, state.epoch, date);
    for (const item of picked) {
      updateRepairCase(runtime, item, {
        selection_count: item.selection_count + 1,
        last_selected_at: date,
        last_epoch: state.epoch,
      });
    }
    if (record) {
      record.question_ids = [...record.question_ids, ...picked.map(item => item.question_id)];
      record.updated_at = nowIso();
    } else {
      record = {
        device_id: deviceId, date, epoch: state.epoch,
        question_ids: picked.map(item => item.question_id), created_at: nowIso(),
      };
      runtime.repairDaily.set(key, record);
    }
    runtime.repairDailyDirty = true;
  }
  const selected = (record?.question_ids || [])
    .map(questionId => cases.find(item => item.question_id === questionId))
    .filter(Boolean)
    .map(item => repairCaseView(item, runtime, deviceId));
  const backlogCount = cases.filter(item => wrongIds.has(item.question_id) && item.repair_passes < PASS_TARGET).length;
  return { date, items: selected, backlog_count: backlogCount };
}
