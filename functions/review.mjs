import { nowIso } from './model.mjs';

const reviewIntervals = [1, 2, 4, 7, 15, 30];

export function recordReviewOutcome(runtime, deviceId, questionId, correct, { attemptId = null, dailyDate = null }) {
  let entry = runtime.wrongBook.find(item => item.device_id === deviceId && item.question_id === questionId);
  if (!entry) {
    if (correct) return;
    entry = {
      device_id: deviceId, question_id: questionId, mastery: 0, review_count: 0,
      first_wrong_at: nowIso(), attempt_history_json: [],
    };
    runtime.wrongBook.push(entry);
  }
  entry.mastery = Math.max(0, Math.min(5, entry.mastery + (correct ? 1 : -1)));
  if (correct) entry.review_count += 1;
  entry.last_result = correct ? 'correct' : 'wrong';
  const reviewBase = dailyDate ? Date.parse(`${dailyDate}T00:00:00+08:00`) : Date.now();
  entry.next_review_at = new Date(reviewBase + reviewIntervals[entry.mastery] * 86400000).toISOString();
  entry.attempt_id = attemptId;
  entry.daily_date = dailyDate;
  if (attemptId) entry.attempt_history_json = [...(entry.attempt_history_json || []), attemptId];
}

export function listWrongBook(deviceId, runtime) {
  return runtime.wrongBook.filter(w => w.device_id === deviceId).map(w => {
    const daily = w.daily_date ? runtime.dailyQuestions.get(`${deviceId}:${w.daily_date}`) : null;
    return {
      ...w,
      question: daily?.question_snapshot || runtime.questions.find(q => q.id === w.question_id),
      attempt: w.attempt_id ? runtime.attempts.find(a => a.id === w.attempt_id) : null,
      daily_answer: daily?.judgment ? {
        date: daily.date, correct: daily.judgment.correct, answer_kind: daily.judgment.answer_kind,
        answer_raw: daily.answer_raw || null, feedback: daily.judgment.feedback,
      } : null,
    };
  });
}
export function todayReview(deviceId, runtime) {
  const now = nowIso();
  return listWrongBook(deviceId, runtime).filter(w => w.next_review_at <= now);
}
export function variantMastery(wrong, deviceId, runtime) {
  const variantIds = new Set(runtime.questions
    .filter(q => q.source === 'ai' && q.generator_meta_json?.variant_of === wrong.question_id)
    .map(q => q.id));
  if (!variantIds.size) {
    return { total: 0, answered: 0, correct: 0, rate_bp: null, mastered: false, paper_id: null, paper_status: null, pending: false };
  }
  const papers = runtime.papers
    .filter(paper => paper.device_id === deviceId && paper.items_json.some(item => variantIds.has(item.question_id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const submitted = papers.filter(paper => paper.status === 'submitted');
  const target = submitted[0] || papers[0];
  if (!target) {
    return { total: 0, answered: 0, correct: 0, rate_bp: null, mastered: false, paper_id: null, paper_status: null, pending: false };
  }
  const ids = new Set(target.items_json
    .filter(item => variantIds.has(item.question_id))
    .map(item => item.question_id));
  const attempts = runtime.attempts.filter(attempt => attempt.device_id === deviceId
    && attempt.paper_instance_id === target.id && ids.has(attempt.question_id));
  const total = ids.size;
  const correct = attempts.filter(attempt => attempt.score_x2 === attempt.max_score_x2).length;
  return {
    total, answered: attempts.length, correct,
    rate_bp: target.status === 'submitted' && total ? Math.round(correct * 10000 / total) : null,
    mastered: target.status === 'submitted' && total > 0 && correct === total,
    paper_id: target.id, paper_status: target.status, pending: target.status !== 'submitted',
  };
}
export function similarQuestions(questionId, deviceId, runtime) {
  const source = runtime.questions.find(q => q.id === questionId);
  if (!source) return [];
  const sourceNodes = new Set(source.knowledge.map(k => k.code));
  return runtime.questions.filter(q => q.id !== questionId && q.status === 'published'
    && q.qtype === source.qtype && q.knowledge.some(k => sourceNodes.has(k.code))
    && !runtime.attempts.some(a => a.device_id === deviceId && a.question_id === q.id))
    .map(q => ({ question: q, reason: `同考查${q.knowledge.map(k => k.code).join('、')}，题型一致` })).slice(0, 3);
}
