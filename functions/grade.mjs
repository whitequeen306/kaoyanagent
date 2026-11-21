import { fail, uuid, nowIso, normalizeText } from './model.mjs';

export function publicQuestion(question) {
  return {
    id: question.id, seq_label: question.seq_label, qtype: question.qtype,
    section: question.section, stem_latex: question.stem_latex,
    options_json: question.options_json, sub_items_json: question.sub_items_json?.map(item => ({
      label: item.label, prompt_latex: item.prompt_latex, score_x2: item.score_x2,
    })) || null,
    score_x2: question.score_x2, difficulty: question.difficulty, source: question.source,
    year: question.year || null, is_fixture: Boolean(question.is_fixture),
    score_source: question.generator_meta_json?.score_source || null,
  };
}
export function reviewQuestion(question) {
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
  const intervals = [1, 2, 4, 7, 15, 30];
  for (const attempt of attempts) {
    const wrong = attempt.score_x2 < attempt.max_score_x2 && attempt.grading_status === 'completed';
    const key = `${submission.device_id}:${attempt.question_id}`;
    const existing = runtime.wrongBook.find(w => `${w.device_id}:${w.question_id}` === key);
    if (wrong) {
      const mastery = existing ? Math.max(0, existing.mastery - 1) : 0;
      const next = new Date(Date.now() + intervals[mastery] * 86400000).toISOString();
      if (existing) {
        existing.attempt_id = attempt.id;
        existing.attempt_history_json = [...(existing.attempt_history_json || []), attempt.id];
        existing.mastery = mastery; existing.next_review_at = next; existing.last_result = 'wrong';
      } else {
        runtime.wrongBook.push({
          device_id: submission.device_id, question_id: attempt.question_id, attempt_id: attempt.id,
          attempt_history_json: [attempt.id], first_wrong_at: nowIso(), mastery: 0,
          next_review_at: next, review_count: 0, last_result: 'wrong',
        });
      }
    } else if (existing && attempt.grading_status === 'completed') {
      existing.mastery = Math.min(5, existing.mastery + 1);
      existing.next_review_at = new Date(Date.now() + intervals[existing.mastery] * 86400000).toISOString();
      existing.last_result = 'correct'; existing.review_count += 1;
      existing.attempt_id = attempt.id;
      existing.attempt_history_json = [...(existing.attempt_history_json || []), attempt.id];
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
