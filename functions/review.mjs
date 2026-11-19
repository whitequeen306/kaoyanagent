import { nowIso } from './model.mjs';
export function listWrongBook(deviceId, runtime) {
  return runtime.wrongBook.filter(w => w.device_id === deviceId).map(w => ({
    ...w,
    question: runtime.questions.find(q => q.id === w.question_id),
    attempt: runtime.attempts.find(a => a.id === w.attempt_id),
  }));
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
