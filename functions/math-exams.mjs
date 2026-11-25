import { fail, uuid, nowIso } from './model.mjs';
import { publicQuestion, submissionSummary } from './grade.mjs';

const SECTION_ORDER = { single_choice: 0, fill_blank: 1, free_response: 2 };

function mathQuestionsForYear(runtime, year) {
  return runtime.questions
    .filter(question => (question.subject || 'math2') === 'math2'
      && question.source === 'real'
      && question.year === year)
    .sort((a, b) => (SECTION_ORDER[a.qtype] - SECTION_ORDER[b.qtype])
      || String(a.seq_label).localeCompare(String(b.seq_label), 'zh-CN', { numeric: true }));
}

function yearPapers(runtime, deviceId, year) {
  return runtime.papers
    .filter(paper => paper.device_id === deviceId
      && (paper.subject || 'math2') === 'math2'
      && paper.config_json?.math_year === year)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function listMathExamYears(runtime, deviceId) {
  const groups = new Map();
  for (const question of runtime.questions) {
    if ((question.subject || 'math2') !== 'math2' || question.source !== 'real' || !question.year) continue;
    const row = groups.get(question.year) || {
      year: question.year, question_count: 0, single_choice: 0, fill_blank: 0, free_response: 0, total_score_x2: 0, held_count: 0,
    };
    row.question_count += 1;
    row[question.qtype] = (row[question.qtype] || 0) + 1;
    row.total_score_x2 += question.score_x2 || 0;
    if (question.status !== 'published') row.held_count += 1;
    groups.set(question.year, row);
  }
  return [...groups.values()].map(row => {
    const papers = yearPapers(runtime, deviceId, row.year);
    const latest = papers[0] || null;
    const summary = latest?.status === 'submitted' ? submissionSummary(latest, runtime.attempts) : null;
    const answeredQuestions = latest
      ? runtime.attempts.filter(attempt => attempt.paper_instance_id === latest.id && (attempt.answer_raw || '').trim()).length
      : 0;
    return {
      ...row,
      paper_id: latest?.id || null,
      status: latest?.status || null,
      created_at: latest?.created_at || null,
      submitted_at: latest?.submitted_at || null,
      score_x2: summary?.score_x2 ?? null,
      max_score_x2: summary?.max_score_x2 ?? row.total_score_x2,
      score_rate_bp: summary?.score_rate_bp ?? null,
      attempt_count: papers.length,
      answered_questions: answeredQuestions,
    };
  }).sort((a, b) => b.year - a.year);
}

export function createMathExamPaper(runtime, deviceId, year, restart = false) {
  const questions = mathQuestionsForYear(runtime, year);
  if (!questions.length) fail('not_found', 404);
  const existing = yearPapers(runtime, deviceId, year)[0];
  if (existing && !restart) return existing;
  const held = questions.filter(question => question.status !== 'published').length;
  const items = questions.map(question => ({
    question_id: question.id,
    question: structuredClone(publicQuestion(question)),
    score_x2: question.score_x2,
  }));
  const paper = {
    id: uuid(),
    device_id: deviceId,
    subject: 'math2',
    mode: 'exam',
    source_mode: 'real',
    origin: 'math_exam',
    title: `${year} 年考研数学二真题`,
    config_json: { math_year: year },
    items_json: items,
    total_score_x2: items.reduce((sum, item) => sum + item.score_x2, 0),
    status: 'draft',
    created_at: nowIso(),
    submitted_at: null,
    adjustments: held ? [`该年有 ${held} 道题源缺图，已保留题干并在题卡中标注。`] : [],
    actual_ratio: { real: questions.length, ai: 0 },
    dataset: runtime.dataset || 'production',
  };
  runtime.papers.push(paper);
  return paper;
}
