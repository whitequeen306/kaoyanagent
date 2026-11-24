import { fail, uuid, nowIso, normalizeText } from './model.mjs';
import { recordReviewOutcome } from './review.mjs';

export function publicQuestion(question) {
  if (question.subject === 'cs408') {
    return {
      id: question.id, seq_label: question.seq_label, qtype: question.qtype,
      section: question.section, subject: 'cs408', year: question.year || null,
      number: question.number, title: question.title || null,
      question_html: question.question_html || '', question_text: question.question_text || '',
      options: question.options || [], figures: question.figures || [],
      score_x2: question.score_x2, score_source: question.score_source || null,
      difficulty: question.difficulty, source: question.source || 'real', is_fixture: false,
      has_explanation: Boolean(question.has_explanation),
      ai_kind: question.ai_kind || (question.generator_meta_json?.variant_of ? 'variant' : 'practice'),
      knowledge: question.knowledge || [],
    };
  }
  return {
    id: question.id, seq_label: question.seq_label, qtype: question.qtype,
    section: question.section, stem_latex: question.stem_latex,
    options_json: question.options_json, sub_items_json: question.sub_items_json?.map(item => ({
      label: item.label, prompt_latex: item.prompt_latex, score_x2: item.score_x2,
    })) || null,
    score_x2: question.score_x2, difficulty: question.difficulty, source: question.source,
    year: question.year || null, is_fixture: Boolean(question.is_fixture),
    has_figure: Boolean(question.has_figure), figure_asset_id: question.figure_asset_id || null,
    figure_assets: question.figure_assets || [],
    score_source: question.generator_meta_json?.score_source || null,
  };
}
export function reviewQuestion(question) {
  if (question.subject === 'cs408') {
    return {
      correct_answer: question.answer_latex || '',
      explanation: question.answer_text || question.explanation || '',
      explanation_html: question.answer_html || '',
      solution_steps: [],
      has_explanation: Boolean(question.has_explanation),
    };
  }
  return {
    correct_answer: question.answer_latex,
    explanation: question.generator_meta_json?.approach_raw || question.generator_meta_json?.exam_point_raw || '',
    solution_steps: question.generator_meta_json?.solution_steps || [],
  };
}
export function gradeObjective(question, answerRaw) {
  const raw = String(answerRaw ?? '').trim();
  if (!raw) return { score_x2: 0, correct: false, reason: '未作答' };
  if (question.qtype === 'single_choice') {
    const answer = raw.toUpperCase();
    if (!/^[A-D]$/.test(answer)) return { score_x2: 0, correct: false, reason: '请选择一个选项' };
    const expected = String(question.answer_latex).trim().toUpperCase();
    const correct = answer === expected;
    return { score_x2: correct ? question.score_x2 : 0, correct, reason: correct ? '答案正确' : '答案与参考答案不一致' };
  }
  const expected = normalizeText(question.answer_latex);
  const actual = normalizeText(raw);
  const aliases = question.answer_aliases || [];
  const correct = actual === expected || aliases.some(a => normalizeText(a) === actual);
  return { score_x2: correct ? question.score_x2 : 0, correct, reason: correct ? '答案正确' : '当前切片仅支持规范化答案比对；复杂等价式需进入后续符号校验。' };
}
export function gradeSubmission(paper, submission, runtime) {
  if (!paper || paper.device_id !== submission.device_id) fail('not_found', 404);
  if (paper.status === 'submitted') return runtime.attempts.filter(a => a.paper_instance_id === paper.id);
  if (!Array.isArray(submission.answers)) fail('invalid_input');
  const answerMap = new Map(submission.answers.map(a => [a.question_id, a]));
  if (answerMap.size !== submission.answers.length) fail('invalid_input');
  const attempts = [];
  for (const item of paper.items_json) {
    const question = runtime.questions.find(q => q.id === item.question_id)
      || item.question;
    if (!question) fail('not_found', 404);
    const input = answerMap.get(question.id);
    const raw = input?.answer_raw || '';
    if (question.qtype === 'free_response') {
      const pending = Boolean(raw.trim());
      attempts.push({
        id: uuid(), device_id: submission.device_id, paper_instance_id: paper.id, question_id: question.id,
        answer_raw: raw, confirmed_latex: input?.confirmed_latex || null,
        score_x2: 0, max_score_x2: question.score_x2, score_rate_bp: 0,
        rubric_json: question.rubric_json, rubric_version: question.rubric_version,
        error_tags_json: pending ? ['pending_rubric_grading'] : ['unanswered'],
        duration_sec: input?.duration_sec ?? null, created_at: nowIso(),
        grading_status: pending ? 'pending_review' : 'completed', feedback: pending ? '解答题待 rubric 模型复核' : '未作答',
      });
      continue;
    }
    const result = gradeObjective(question, raw);
    attempts.push({
      id: uuid(), device_id: submission.device_id, paper_instance_id: paper.id, question_id: question.id,
      answer_raw: raw, answer_normalized_json: { normalized: normalizeText(raw) },
      confirmed_latex: input?.confirmed_latex || null,
      score_x2: result.score_x2, max_score_x2: question.score_x2,
      score_rate_bp: question.score_x2 ? Math.round(result.score_x2 * 10000 / question.score_x2) : 0,
      rubric_json: question.rubric_json, rubric_version: question.rubric_version,
      error_tags_json: result.correct ? [] : [raw.trim() ? 'answer_mismatch' : 'unanswered'],
      duration_sec: input?.duration_sec ?? null, created_at: nowIso(),
      grading_status: 'completed', feedback: result.reason,
    });
  }
  runtime.attempts.push(...attempts);
  for (const attempt of attempts) {
    if (attempt.grading_status === 'completed') {
      recordReviewOutcome(runtime, submission.device_id, attempt.question_id,
        attempt.score_x2 >= attempt.max_score_x2, { attemptId: attempt.id });
    }
  }
  paper.status = 'submitted'; paper.submitted_at = nowIso();
  return attempts;
}
export function submissionSummary(paper, attempts) {
  const mine = attempts.filter(a => a.paper_instance_id === paper.id);
  const score = mine.reduce((s, a) => s + a.score_x2, 0);
  const max = mine.reduce((s, a) => s + a.max_score_x2, 0);
  const bySource = {};
  for (const source of ['real', 'ai']) {
    const ids = new Set(paper.items_json.filter(i => i.question.source === source).map(i => i.question_id));
    const rows = mine.filter(a => ids.has(a.question_id));
    bySource[source] = { score_x2: rows.reduce((s, a) => s + a.score_x2, 0), max_score_x2: rows.reduce((s, a) => s + a.max_score_x2, 0) };
  }
  return { score_x2: score, max_score_x2: max, score_rate_bp: max ? Math.round(score * 10000 / max) : 0, by_source: bySource };
}
