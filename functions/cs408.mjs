import { fail, uuid, nowIso } from './model.mjs';
import { gradeObjective, publicQuestion, reviewQuestion } from './grade.mjs';
import { recordReviewOutcome } from './review.mjs';
import { repairCaseView, syncRepairForPaper } from './repair.mjs';

const AUTO_SINGLE_SCORE_X2 = 160;
const PAPER_SCORE_X2 = 300;

function shuffle(items) {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

function autoScoreFor(paper) {
  if (!paper) return 0;
  if (paper.config_json?.cs408_auto_score_x2) return paper.config_json.cs408_auto_score_x2;
  return paper.items_json
    .filter(item => item.question?.qtype === 'single_choice')
    .reduce((sum, item) => sum + (item.question?.score_x2 || item.score_x2 || 0), 0);
}

function nodeChapterCodes(runtime, node) {
  if (!node) return [];
  if (node.level === 1) {
    return runtime.cs408Knowledge.filter(item => item.parent_id === node.id && item.level === 2).map(item => item.code);
  }
  if (node.level === 3) {
    return runtime.cs408Knowledge.filter(item => item.id === node.parent_id).map(item => item.code);
  }
  return [node.code];
}

export function cs408NodeQuestionCount(runtime, node, qtype = 'single_choice') {
  const codes = new Set(nodeChapterCodes(runtime, node));
  return runtime.questions.filter(question => question.subject === 'cs408'
    && question.qtype === qtype
    && question.status === 'published'
    && question.knowledge.some(knowledge => codes.has(knowledge.code))).length;
}

function attemptView(attempt) {
  return {
    question_id: attempt.question_id,
    score_x2: attempt.score_x2,
    max_score_x2: attempt.max_score_x2,
    score_rate_bp: attempt.score_rate_bp,
    grading_status: attempt.grading_status,
    answer_raw: attempt.answer_raw,
    confirmed_latex: attempt.confirmed_latex || null,
    feedback: attempt.feedback || null,
  };
}

export function cs408YearPapers(runtime, deviceId, year) {
  return runtime.papers
    .filter(paper => paper.device_id === deviceId && paper.subject === 'cs408' && paper.config_json?.cs408_year === year)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function cs408Summary(paper, runtime) {
  const attempts = runtime.attempts.filter(attempt => attempt.paper_instance_id === paper.id);
  const single = attempts.filter(attempt => attempt.max_score_x2 > 0);
  const score = single.reduce((sum, attempt) => sum + attempt.score_x2, 0);
  const max = single.reduce((sum, attempt) => sum + attempt.max_score_x2, 0);
  return {
    score_x2: score,
    max_score_x2: max || autoScoreFor(paper),
    score_rate_bp: max ? Math.round(score * 10000 / max) : 0,
    single_answered: single.length,
    free_answered: attempts.filter(attempt => attempt.max_score_x2 === 0 && attempt.answer_raw?.trim()).length,
  };
}

export function listCs408Years(runtime, deviceId) {
  return runtime.cs408Papers.map(meta => {
    const papers = cs408YearPapers(runtime, deviceId, meta.year);
    const latest = papers[0] || null;
    const summary = latest?.status === 'submitted' ? cs408Summary(latest, runtime) : null;
    return {
      ...meta,
      paper_id: latest?.id || null,
      status: latest?.status || null,
      created_at: latest?.created_at || null,
      submitted_at: latest?.submitted_at || null,
      score_x2: summary?.score_x2 ?? null,
      max_score_x2: summary?.max_score_x2 ?? autoScoreFor(latest),
      score_rate_bp: summary?.score_rate_bp ?? null,
      attempt_count: papers.length,
    };
  }).sort((a, b) => b.year - a.year);
}

export function createCs408Paper(runtime, deviceId, year, restart = false) {
  const meta = runtime.cs408Papers.find(item => item.year === year);
  if (!meta) fail('not_found', 404);
  const existing = cs408YearPapers(runtime, deviceId, year)[0];
  if (existing && !restart) return existing;
  const questions = runtime.questions
    .filter(question => question.subject === 'cs408' && question.year === year && question.status === 'published')
    .sort((a, b) => a.number - b.number);
  if (questions.length !== 47) fail('insufficient_questions', 409);
  const items = questions.map(question => ({
    question_id: question.id,
    question: structuredClone(publicQuestion(question)),
    score_x2: question.score_x2,
  }));
  const paper = {
    id: uuid(),
    device_id: deviceId,
    subject: 'cs408',
    mode: 'exam',
    source_mode: 'real',
    origin: 'cs408_exam',
    title: `${year} 年考研 408 真题`,
    config_json: { cs408_year: year, cs408_auto_score_x2: AUTO_SINGLE_SCORE_X2 },
    items_json: items,
    total_score_x2: PAPER_SCORE_X2,
    status: 'draft',
    created_at: nowIso(),
    submitted_at: null,
    adjustments: [],
    actual_ratio: { real: questions.length, ai: 0 },
    dataset: runtime.dataset || 'production',
  };
  runtime.papers.push(paper);
  return paper;
}

export function createCs408PracticePaper(runtime, deviceId, nodeIds, count, options = {}) {
  if (!Array.isArray(nodeIds) || !nodeIds.length) fail('invalid_input');
  const typeCounts = options.type_counts && typeof options.type_counts === 'object'
    ? Object.fromEntries(Object.entries(options.type_counts).filter(([type, value]) => ['single_choice', 'free_response'].includes(type) && Number.isInteger(value) && value > 0))
    : { single_choice: count };
  if (!Object.keys(typeCounts).length) fail('invalid_input');
  const total = Object.values(typeCounts).reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > 30) fail('invalid_input');
  if (options.mode !== undefined && !['exam', 'drill'].includes(options.mode)) fail('invalid_input');
  const mode = options.mode || 'drill';
  const yearFrom = Number(options.year_from) || null;
  const yearTo = Number(options.year_to) || null;
  if (yearFrom && yearTo && yearFrom > yearTo) fail('invalid_input');
  const nodes = nodeIds.map(id => runtime.cs408Knowledge.find(node => node.id === id));
  if (nodes.some(node => !node)) fail('invalid_input');
  const codes = new Set(nodes.flatMap(node => nodeChapterCodes(runtime, node)));
  const completed = options.exclude_done === true ? new Set(runtime.attempts
    .filter(attempt => attempt.device_id === deviceId && attempt.score_x2 === attempt.max_score_x2)
    .map(attempt => attempt.question_id)) : new Set();
  const pool = runtime.questions.filter(question => question.subject === 'cs408'
    && ['single_choice', 'free_response'].includes(question.qtype)
    && Object.hasOwn(typeCounts, question.qtype)
    && question.status === 'published'
    && question.knowledge.some(knowledge => codes.has(knowledge.code))
    && (!yearFrom || question.year >= yearFrom)
    && (!yearTo || question.year <= yearTo)
    && !completed.has(question.id));
  const chosen = [];
  for (const [qtype, amount] of Object.entries(typeCounts)) {
    const rows = pool.filter(question => question.qtype === qtype);
    if (rows.length < amount) fail('insufficient_questions', 409);
    chosen.push(...shuffle(rows).slice(0, amount));
  }
  const sectionOrder = { single_choice: 0, free_response: 1 };
  chosen.sort((a, b) => (sectionOrder[a.qtype] - sectionOrder[b.qtype])
    || (mode === 'exam' ? (a.year - b.year) || (a.number - b.number) : 0));
  const items = chosen.map(question => ({
    question_id: question.id,
    question: structuredClone(publicQuestion(question)),
    score_x2: question.score_x2,
  }));
  const names = nodes.map(node => node.name);
  const singleCount = chosen.filter(question => question.qtype === 'single_choice').length;
  const paper = {
    id: uuid(),
    device_id: deviceId,
    subject: 'cs408',
    mode,
    source_mode: 'real',
    origin: 'cs408_practice',
    title: `${names.slice(0, 2).join(' · ')} · 408 ${mode === 'exam' ? '综合练习' : '专项练习'}`,
    config_json: {
      cs408_node_ids: nodeIds,
      cs408_node_names: names,
      cs408_count: total,
      cs408_type_counts: typeCounts,
      cs408_year_from: yearFrom,
      cs408_year_to: yearTo,
      cs408_exclude_done: options.exclude_done === true,
      cs408_auto_score_x2: singleCount * 4,
    },
    items_json: items,
    total_score_x2: items.reduce((sum, item) => sum + item.score_x2, 0),
    status: 'draft',
    created_at: nowIso(),
    submitted_at: null,
    adjustments: [],
    actual_ratio: { real: chosen.length, ai: 0 },
    dataset: runtime.dataset || 'production',
  };
  runtime.papers.push(paper);
  return paper;
}

export function cs408PaperView(paper, runtime) {
  if (!paper || paper.subject !== 'cs408') fail('not_found', 404);
  const attempts = runtime.attempts.filter(attempt => attempt.paper_instance_id === paper.id);
  const result = paper.status === 'submitted' ? {
    attempts: attempts.map(attempt => {
      const question = runtime.questions.find(item => item.id === attempt.question_id)
        || paper.items_json.find(item => item.question_id === attempt.question_id)?.question;
      return { ...attemptView(attempt), ...(question ? reviewQuestion(question) : {}) };
    }),
    ...cs408Summary(paper, runtime),
  } : null;
  return {
    id: paper.id,
    subject: 'cs408',
    year: paper.config_json?.cs408_year || null,
    title: paper.title,
    mode: paper.mode,
    source_mode: paper.source_mode,
    origin: paper.origin || null,
    status: paper.status,
    created_at: paper.created_at,
    submitted_at: paper.submitted_at,
    items: paper.items_json,
    total_score_x2: paper.total_score_x2,
    auto_score_x2: autoScoreFor(paper),
    result,
  };
}

export function gradeCs408Submission(paper, submission, runtime) {
  if (!paper || paper.device_id !== submission.device_id || paper.subject !== 'cs408') fail('not_found', 404);
  if (paper.status === 'submitted') return cs408PaperView(paper, runtime);
  if (!Array.isArray(submission.answers)) fail('invalid_input');
  const answerMap = new Map(submission.answers.map(answer => [answer.question_id, answer]));
  if (answerMap.size !== submission.answers.length) fail('invalid_input');
  const attempts = [];
  for (const item of paper.items_json) {
    const question = runtime.questions.find(candidate => candidate.id === item.question_id) || item.question;
    if (!question) fail('not_found', 404);
    const input = answerMap.get(question.id);
    const raw = input?.answer_raw || '';
    if (question.qtype === 'free_response') {
      attempts.push({
        id: uuid(), device_id: submission.device_id, paper_instance_id: paper.id, question_id: question.id,
        answer_raw: raw, confirmed_latex: null, score_x2: 0, max_score_x2: 0, score_rate_bp: 0,
        rubric_json: null, rubric_version: 1, error_tags_json: [],
        duration_sec: input?.duration_sec ?? null, created_at: nowIso(),
        grading_status: 'self_review',
        feedback: raw.trim() ? '综合题不自动判分，请对照解析自评。' : '综合题未作答，可直接查看解析。',
      });
      continue;
    }
    const graded = gradeObjective(question, raw);
    attempts.push({
      id: uuid(), device_id: submission.device_id, paper_instance_id: paper.id, question_id: question.id,
      answer_raw: raw, answer_normalized_json: { normalized: raw.trim().toUpperCase() },
      confirmed_latex: null, score_x2: graded.score_x2, max_score_x2: question.score_x2,
      score_rate_bp: question.score_x2 ? Math.round(graded.score_x2 * 10000 / question.score_x2) : 0,
      rubric_json: null, rubric_version: 1,
      error_tags_json: graded.correct ? [] : [raw.trim() ? 'answer_mismatch' : 'unanswered'],
      duration_sec: input?.duration_sec ?? null, created_at: nowIso(),
      grading_status: 'completed', feedback: graded.reason,
    });
  }
  runtime.attempts.push(...attempts);
  for (const attempt of attempts) {
    if (attempt.grading_status === 'completed') {
      recordReviewOutcome(runtime, submission.device_id, attempt.question_id,
        attempt.score_x2 >= attempt.max_score_x2, { attemptId: attempt.id });
    }
  }
  paper.status = 'submitted';
  paper.submitted_at = nowIso();
  syncRepairForPaper(runtime, paper);
  return cs408PaperView(paper, runtime);
}

function ensureCs408Fields(repair) {
  repair.subject = 'cs408';
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

export function ensureCs408RepairCases(deviceId, runtime) {
  runtime.repairCases ||= [];
  const existing = new Set(runtime.repairCases.filter(item => item.device_id === deviceId && item.subject === 'cs408').map(item => item.question_id));
  for (const wrong of runtime.wrongBook.filter(item => item.device_id === deviceId)) {
    const question = runtime.questions.find(item => item.id === wrong.question_id);
    if (!question || question.subject !== 'cs408' || question.qtype !== 'single_choice') continue;
    if (existing.has(wrong.question_id)) continue;
    existing.add(wrong.question_id);
    runtime.repairCases.push(ensureCs408Fields({
      id: uuid(), device_id: deviceId, subject: 'cs408', question_id: wrong.question_id,
      status: 'new', diagnosis: null, job_id: null, paper_id: null,
      created_at: nowIso(), updated_at: nowIso(), completed_at: null,
    }));
  }
  return runtime.repairCases
    .filter(item => item.device_id === deviceId && item.subject === 'cs408')
    .map(ensureCs408Fields);
}

function dailyHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function listCs408RepairCases(deviceId, runtime) {
  const cases = ensureCs408RepairCases(deviceId, runtime);
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const views = cases.map(item => repairCaseView(item, runtime, deviceId))
    .filter(view => view.question)
    .map(view => ({
      ...view,
      question: publicQuestion(view.question),
      knowledge: (view.question.knowledge || []).map(node => ({
        code: node.code,
        name: runtime.cs408Knowledge.find(candidate => candidate.code === node.code)?.name || node.code,
      })),
    }));
  const active = views.filter(view => view.repair_passes < 5);
  const rank = { needs_retry: 0, ready: 1, generating: 2, new: 3, passed: 4 };
  active.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    || dailyHash(`${deviceId}:${date}:${a.question_id}`) - dailyHash(`${deviceId}:${date}:${b.question_id}`));
  const items = active.slice(0, 4);
  return {
    date,
    items,
    backlog_count: active.length,
    completed_count: views.filter(view => view.repair_passes >= 5 || view.status === 'completed').length,
  };
}

export function listCs408WrongBook(deviceId, runtime) {
  return runtime.wrongBook
    .filter(entry => entry.device_id === deviceId)
    .map(entry => {
      const question = runtime.questions.find(item => item.id === entry.question_id);
      if (question?.subject !== 'cs408') return null;
      const attempt = entry.attempt_id ? runtime.attempts.find(item => item.id === entry.attempt_id) : null;
      return {
        question_id: entry.question_id,
        first_wrong_at: entry.first_wrong_at,
        last_result: entry.last_result,
        review_count: entry.review_count,
        question: publicQuestion(question),
        attempt: attempt ? attemptView(attempt) : null,
        review: reviewQuestion(question),
        knowledge: (question.knowledge || []).map(node => ({
          code: node.code,
          name: runtime.cs408Knowledge.find(candidate => candidate.code === node.code)?.name || node.code,
        })),
      };
    })
    .filter(Boolean);
}

export function listCs408History(runtime, deviceId) {
  return runtime.papers
    .filter(paper => paper.device_id === deviceId && paper.subject === 'cs408')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(paper => {
      const summary = paper.status === 'submitted' ? cs408Summary(paper, runtime) : null;
      return {
        id: paper.id,
        origin: paper.origin || null,
        mode: paper.mode,
        year: paper.config_json?.cs408_year || null,
        title: paper.title,
        status: paper.status,
        created_at: paper.created_at,
        submitted_at: paper.submitted_at,
        questions: paper.items_json.length,
        total_score_x2: paper.total_score_x2,
        auto_score_x2: autoScoreFor(paper) || 0,
        score_x2: summary?.score_x2 ?? null,
        max_score_x2: (summary?.max_score_x2 ?? autoScoreFor(paper)) || 0,
        score_rate_bp: summary?.score_rate_bp ?? null,
        node_names: paper.config_json?.cs408_node_names || [],
      };
    });
}

export function cs408Metrics(runtime, deviceId) {
  const papers = runtime.papers.filter(paper => paper.device_id === deviceId && paper.subject === 'cs408');
  const paperIds = new Set(papers.map(paper => paper.id));
  const attempts = runtime.attempts.filter(attempt => paperIds.has(attempt.paper_instance_id) && attempt.max_score_x2 > 0);
  const submitted = papers.filter(paper => paper.status === 'submitted');
  const correct = attempts.filter(attempt => attempt.score_x2 === attempt.max_score_x2).length;
  const score = attempts.reduce((sum, attempt) => sum + attempt.score_x2, 0);
  const max = attempts.reduce((sum, attempt) => sum + attempt.max_score_x2, 0);
  const wrong = runtime.wrongBook.filter(entry => {
    const question = runtime.questions.find(item => item.id === entry.question_id);
    return entry.device_id === deviceId && question?.subject === 'cs408';
  });
  const byChapter = new Map();
  for (const attempt of attempts) {
    const question = runtime.questions.find(item => item.id === attempt.question_id);
    const code = question?.knowledge?.[0]?.code;
    if (!code) continue;
    const node = runtime.cs408Knowledge.find(item => item.code === code);
    const row = byChapter.get(code) || {
      code, name: node?.name || code, subject: node?.parent_id || null,
      attempts: 0, correct: 0, score_x2: 0, max_score_x2: 0,
    };
    row.attempts += 1;
    row.correct += attempt.score_x2 === attempt.max_score_x2 ? 1 : 0;
    row.score_x2 += attempt.score_x2;
    row.max_score_x2 += attempt.max_score_x2;
    byChapter.set(code, row);
  }
  const chapters = [...byChapter.values()]
    .map(row => ({ ...row, score_rate_bp: row.max_score_x2 ? Math.round(row.score_x2 * 10000 / row.max_score_x2) : null }))
    .sort((a, b) => a.score_x2 / a.max_score_x2 - b.score_x2 / b.max_score_x2);
  const examYears = new Set(submitted.filter(paper => paper.config_json?.cs408_year).map(paper => paper.config_json.cs408_year));
  return {
    question_bank: runtime.questions.filter(question => question.subject === 'cs408' && question.status === 'published').length,
    papers: papers.length,
    submitted: submitted.length,
    exam_years_done: examYears.size,
    practice_papers: papers.filter(paper => paper.origin === 'cs408_practice').length,
    repair_papers: papers.filter(paper => paper.origin === 'repair').length,
    single_attempts: attempts.length,
    wrong_count: wrong.length,
    score_x2: score,
    max_score_x2: max,
    score_rate_bp: max ? Math.round(score * 10000 / max) : null,
    chapters: chapters.slice(0, 12),
    recent: listCs408History(runtime, deviceId).slice(0, 6),
  };
}
