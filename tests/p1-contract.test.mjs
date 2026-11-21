import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { application, errorResponse } from '../functions/routes.mjs';
import { createLocalRuntime } from '../functions/runtime.mjs';
import { composePaper } from '../functions/compose.mjs';
import { createPaperJob } from '../functions/generate.mjs';
import { createPersistence } from '../dev/persist.mjs';
import { buildAgentContext, contextBudget, resolveModelProfile } from '../functions/agent-context.mjs';
import { DatabaseSync } from 'node:sqlite';
const device = 'test-device-0001';
const key = () => `test-key-${crypto.randomUUID()}`;

function raw(handle, path, { method = 'GET', body, headers = {} } = {}) {
  const request = new Request(`http://localhost/functions/v1/app${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-device-id': device, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return Promise.resolve()
    .then(() => handle(request))
    .catch(error => errorResponse(error))
    .then(async response => ({ status: response.status, body: await response.json() }));
}
let tokenCache = new Map();
async function call(handle, path, options = {}) {
  const method = options.method || 'GET';
  let token = null;
  if (method !== 'GET' && path !== '/api/session') {
    if (!tokenCache.has(handle)) {
      const session = await raw(handle, '/api/session', { method: 'POST', body: { device_id: device } });
      assert.equal(session.status, 201);
      tokenCache.set(handle, session.body.token);
    }
    token = tokenCache.get(handle);
  }
  return raw(handle, path, { ...options, headers: { ...(options.key ? { 'idempotency-key': options.key } : {}), ...(token ? { 'x-device-token': token } : {}) } });
}
test('health and knowledge are available', async () => {
  const handle = application(createLocalRuntime());
  assert.equal((await call(handle, '/api/health')).body.ok, true);
  assert.ok((await call(handle, '/api/knowledge')).body.items.length >= 8);
});
test('real paper → submit → wrong book → review and similar questions', async () => {
  const runtime = createLocalRuntime();
  const handle = application(runtime);
  const knowledge = (await call(handle, '/api/knowledge')).body.items;
  const compose = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    concept_node_ids: [knowledge.find(n => n.code === 'GS1').id], qtypes: ['single_choice'], count: 3,
    source_mode: 'real', mode: 'drill', difficulty: 'medium', device_id: device,
  } });
  assert.equal(compose.status, 201, JSON.stringify(compose.body));
  assert.equal(compose.body.items.length, 3);
  const draftHistory = await call(handle, '/api/papers');
  assert.ok(draftHistory.body.items.some(paper => paper.id === compose.body.paper_instance_id && paper.status === 'draft'));
  // Answers and rubrics must never be sent before submission.
  for (const item of compose.body.items) {
    assert.equal(item.question.answer_latex, undefined);
    assert.equal(item.question.rubric_json, undefined);
  }
  const items = compose.body.items;
  const firstCorrect = inferAnswer(runtime, items[0].question.id);
  const firstWrong = firstCorrect === 'A' ? 'B' : 'A';
  const maxScore = items.reduce((sum, item) => sum + item.score_x2, 0);
  const submit = await call(handle, `/api/papers/${compose.body.paper_instance_id}/submit`, { method: 'POST', key: key(), body: {
    device_id: device,
    answers: items.map((i, index) => ({ question_id: i.question.id, answer_raw: index === 0 ? firstWrong : inferAnswer(runtime, i.question.id) })),
  } });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal(submit.body.max_score_x2, maxScore);
  assert.equal(submit.body.score_x2, maxScore - items[0].score_x2);
  assert.ok(submit.body.attempts[0].correct_answer);
  assert.ok('explanation' in submit.body.attempts[0]);
  const submittedHistory = await call(handle, '/api/papers');
  const submittedRow = submittedHistory.body.items.find(paper => paper.id === compose.body.paper_instance_id);
  assert.equal(submittedRow.status, 'submitted');
  assert.equal(submittedRow.score_x2, maxScore - items[0].score_x2);
  const submittedPaper = await call(handle, `/api/papers/${compose.body.paper_instance_id}`);
  assert.equal(submittedPaper.body.result.attempts.length, 3);
  assert.ok(submittedPaper.body.result.attempts[0].correct_answer);
  assert.ok(submittedPaper.body.title.includes('函数'));
  const wrongBook = await call(handle, '/api/wrong-book');
  assert.ok(wrongBook.body.items.length === 1);
  assert.equal(wrongBook.body.items[0].attempt.answer_raw, firstWrong);
  assert.ok(wrongBook.body.items[0].review.correct_answer);
  assert.ok(Array.isArray(wrongBook.body.items[0].review.solution_steps));
  assert.equal((await call(handle, '/api/review/today')).body.count, 0);
  runtime.wrongBook[0].next_review_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call(handle, '/api/review/today')).body.count, 1);
  assert.ok((await call(handle, `/api/questions/${wrongBook.body.items[0].question_id}/similar`)).body.items.length >= 0);
});
function inferAnswer(runtime, id) { return runtime.questions.find(q => q.id === id).answer_latex; }
test('per-type counts are honored and total stays within 30', async () => {
  const handle = application(createLocalRuntime());
  const node = (await call(handle, '/api/knowledge')).body.items.find(n => n.code === 'GS').id;
  const response = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    device_id: device, concept_node_ids: [node], count: 4,
    type_counts: { single_choice: 2, fill_blank: 1, free_response: 1 },
    source_mode: 'real', mode: 'drill', difficulty: 'easy',
  } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const counts = response.body.items.reduce((map, item) => ({ ...map, [item.question.qtype]: (map[item.question.qtype] || 0) + 1 }), {});
  assert.equal(counts.single_choice, 2);
  assert.equal(counts.fill_blank, 1);
  assert.equal(counts.free_response, 1);
  assert.equal((await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    device_id: device, concept_node_ids: [node], count: 31,
    type_counts: { single_choice: 31 }, source_mode: 'real', mode: 'drill', difficulty: 'easy',
  } })).status, 400);
});

test('AI paper job advances through generation, blind solve and assembly', async () => {
  let calls = 0;
  const fakeLlm = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ items: [
      { qtype: 'single_choice', stem_latex: '$1+1=$（ ）', options: [{label:'A',latex:'$1$'},{label:'B',latex:'$2$'},{label:'C',latex:'$3$'},{label:'D',latex:'$4$'}], answer_latex: 'B', knowledge_code: 'GS1-01', exam_point: '函数概念', difficulty: 'easy', solution_steps: [] },
      { qtype: 'fill_blank', stem_latex: '$2+3=$____', options: [], answer_latex: '5', knowledge_code: 'GS1-01', exam_point: '函数概念', difficulty: 'easy', solution_steps: [] },
    ] });
    return JSON.stringify({ answers: [{ index: 1, answer_latex: 'B' }, { index: 2, answer_latex: '5' }] });
  };
  const runtime = createLocalRuntime({ llm: fakeLlm });
  const handle = application(runtime);
  const leaf = (await call(handle, '/api/knowledge')).body.items.find(n => n.code === 'GS1-01');
  const queued = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    device_id: device, concept_node_ids: [leaf.id], count: 2,
    type_counts: { single_choice: 1, fill_blank: 1 }, source_mode: 'ai', mode: 'drill', difficulty: 'easy',
  } });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  assert.equal(queued.body.expected_count, 2);
  let job;
  const snapshots = [];
  for (let i = 0; i < 4; i += 1) {
    job = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
    snapshots.push(job.body);
    if (job.body.status === 'succeeded' || job.body.status === 'failed') break;
  }
  assert.equal(snapshots[0].status, 'generating');
  assert.equal(snapshots[0].generated_count, 2);
  assert.ok(snapshots[0].detail.includes('2/2'));
  assert.equal(snapshots[1].verified_count, 2);
  assert.ok(snapshots[1].detail.includes('自测通过'));
  const safeJob = await call(handle, `/api/jobs/${queued.body.job_id}`);
  assert.equal(safeJob.body.drafts, undefined);
  assert.equal(safeJob.body.ai_items, undefined);
  assert.equal(job.body.status, 'succeeded', JSON.stringify(job.body));
  assert.equal(job.body.paper.items_json.length, 2);
  assert.equal(job.body.paper.items_json.every(item => item.question.source === 'ai'), true);
  assert.ok(job.body.detail.includes('已完成'));
  assert.equal(runtime.questions.filter(q => q.source === 'ai' && !q.is_fixture).length, 2);
});

test('AI paper reuses the highest-confidence question per slot and generates the rest', async () => {
  let calls = 0;
  let nextRandom = [0.1, 0.9];
  const runtime = createLocalRuntime({
    random: () => nextRandom.shift() ?? 0.9,
    llm: async () => {
      calls += 1;
      if (calls === 1) return JSON.stringify({ items: [{
        qtype: 'single_choice', stem_latex: '$x+1=2$（ ）',
        options: [{ label: 'A', latex: '$0$' }, { label: 'B', latex: '$1$' }, { label: 'C', latex: '$2$' }, { label: 'D', latex: '$3$' }],
        answer_latex: 'B', knowledge_code: 'GS1-01', exam_point: '函数概念', difficulty: 'easy', explanation: '移项。', solution_steps: [],
      }] });
      return JSON.stringify({ answers: [{ index: 1, answer_latex: 'B' }] });
    },
  });
  const leaf = runtime.knowledge.find(node => node.code === 'GS1-01');
  const reusableQuestion = (id, confidence, stem) => ({
    id, seq_label: 'AI', year: null, section: 'choice', qtype: 'single_choice', stem_latex: stem,
    options_json: [{ label: 'A', latex: '$0$' }, { label: 'B', latex: '$1$' }, { label: 'C', latex: '$2$' }, { label: 'D', latex: '$3$' }],
    sub_items_json: null, answer_latex: 'B', answer_source: 'ai_verified', solution_latex: null,
    score_x2: 10, difficulty: 'easy', source: 'ai', difficulty_source: 'model_anchor_2019',
    generator_meta_json: { exam_point_raw: '函数概念', approach_raw: '已验证', solution_steps: [] },
    rubric_json: null, rubric_version: null, content_hash: `reusable-${id}`, status: 'published', is_fixture: false,
    knowledge: [{ code: leaf.code, role: 'main', weight: 100 }], confidence,
  });
  const highConfidence = reusableQuestion(crypto.randomUUID(), 90, '$x+1=2$（高置信度）');
  const lowConfidence = reusableQuestion(crypto.randomUUID(), 40, '$x+1=2$（低置信度）');
  runtime.questions.push(highConfidence, lowConfidence);
  const handle = application(runtime);
  const queued = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    device_id: device, concept_node_ids: [leaf.id], count: 2,
    type_counts: { single_choice: 2 }, source_mode: 'ai', mode: 'drill', difficulty: 'easy',
  } });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const generated = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
  assert.equal(generated.body.status, 'generating');
  assert.equal(generated.body.reused_count, 1);
  assert.equal(generated.body.generated_count, 1);
  assert.ok(generated.body.detail.includes('抽取 1 道'));
  const verified = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
  assert.equal(verified.body.verified_count, 1);
  const completed = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
  assert.equal(completed.body.status, 'succeeded', JSON.stringify(completed.body));
  assert.equal(completed.body.paper.items_json.length, 2);
  assert.ok(completed.body.paper.items_json.some(item => item.question_id === highConfidence.id));
  assert.equal(runtime.questions.find(question => question.id === highConfidence.id).confidence, 89);
  assert.equal(runtime.questions.find(question => question.id === lowConfidence.id).confidence, 40);
  const generatedQuestion = runtime.questions.find(question => !question.is_fixture && question.id !== highConfidence.id && question.id !== lowConfidence.id && question.source === 'ai');
  assert.equal(generatedQuestion.qtype, 'single_choice');
  assert.equal(generatedQuestion.difficulty, 'easy');
  assert.deepEqual(generatedQuestion.knowledge, [{ code: leaf.code, role: 'main', weight: 100 }]);
  assert.equal(generatedQuestion.confidence, 100);
});

test('AI paper completes from reusable questions without a model provider', async () => {
  const runtime = createLocalRuntime({ random: () => 0.1 });
  const leaf = runtime.knowledge.find(node => node.code === 'GS1-01');
  const reusable = {
    id: crypto.randomUUID(), seq_label: 'AI', year: null, section: 'choice', qtype: 'single_choice',
    stem_latex: '$x+1=2$（复用）',
    options_json: [{ label: 'A', latex: '$0$' }, { label: 'B', latex: '$1$' }, { label: 'C', latex: '$2$' }, { label: 'D', latex: '$3$' }],
    sub_items_json: null, answer_latex: 'B', answer_source: 'ai_verified', solution_latex: null,
    score_x2: 10, difficulty: 'easy', source: 'ai', difficulty_source: 'model_anchor_2019',
    generator_meta_json: { exam_point_raw: '函数概念', approach_raw: '移项。', solution_steps: [] },
    rubric_json: null, rubric_version: null, content_hash: 'reusable-without-model', status: 'published', is_fixture: false,
    knowledge: [{ code: leaf.code, role: 'main', weight: 100 }], confidence: 100,
  };
  runtime.questions.push(reusable);
  const handle = application(runtime);
  const queued = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    device_id: device, concept_node_ids: [leaf.id], count: 1,
    type_counts: { single_choice: 1 }, source_mode: 'ai', mode: 'drill', difficulty: 'easy',
  } });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
  const completed = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'succeeded', JSON.stringify(completed.body));
  assert.equal(completed.body.reused_count, 1);
  assert.equal(completed.body.paper.items_json[0].question_id, reusable.id);
  assert.equal(runtime.questions.find(question => question.id === reusable.id).confidence, 99);
});

test('mixed odd totals give the extra question to real sources', () => {
  const runtime = createLocalRuntime();
  const node = runtime.knowledge.find(n => n.code === 'GS1');
  const job = createPaperJob(runtime, {
    device_id: device, concept_node_ids: [node.id],
    type_counts: { single_choice: 1, fill_blank: 1, free_response: 1 }, count: 3,
    source_mode: 'mixed', mode: 'drill', difficulty: 'easy',
  }, device);
  assert.deepEqual(job.config.total_type_counts, { single_choice: 1, fill_blank: 1, free_response: 1 });
  assert.equal(job.config.ai_count, 1);
  assert.equal(Object.values(job.config.type_counts).reduce((sum, n) => sum + n, 0), 1);
  assert.equal(job.config.count - job.config.ai_count, 2);
});
test('mixed AI job keeps requested total, persists answers and exposes a safe preview', async () => {
  let calls = 0;
  const fakeLlm = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ items: [
      { qtype: 'single_choice', stem_latex: '$1+1=$（ ）', options: [{ label: 'A', latex: '$1$' }, { label: 'B', latex: '$2$' }, { label: 'C', latex: '$3$' }, { label: 'D', latex: '$4$' }], answer_latex: 'B', knowledge_code: 'GS1-01', exam_point: '函数概念', difficulty: 'easy', explanation: '直接计算。', solution_steps: [] },
      { qtype: 'fill_blank', stem_latex: '$2+3=$____', options: [], answer_latex: '5', knowledge_code: 'GS1-01', exam_point: '函数概念', difficulty: 'easy', explanation: '两数相加。', solution_steps: [] },
    ] });
    return JSON.stringify({ answers: [{ index: 1, answer_latex: 'B' }, { index: 2, answer_latex: '5' }] });
  };
  const runtime = createLocalRuntime({ llm: fakeLlm });
  const handle = application(runtime);
  const leaf = (await call(handle, '/api/knowledge')).body.items.find(n => n.code === 'GS1-01');
  const queued = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    device_id: device, concept_node_ids: [leaf.id], count: 4,
    type_counts: { single_choice: 2, fill_blank: 2 }, source_mode: 'mixed', mode: 'drill', difficulty: 'easy',
  } });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  let job;
  for (let i = 0; i < 4; i += 1) {
    job = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
    if (job.body.status === 'succeeded' || job.body.status === 'failed') break;
  }
  assert.equal(job.body.status, 'succeeded', JSON.stringify(job.body));
  const items = job.body.paper.items_json;
  assert.equal(items.length, 4);
  assert.equal(items.filter(item => item.question.source === 'ai').length, 2);
  const counts = items.reduce((map, item) => ({ ...map, [item.question.qtype]: (map[item.question.qtype] || 0) + 1 }), {});
  assert.deepEqual(counts, { single_choice: 2, fill_blank: 2 });
  const aiQuestion = runtime.questions.find(q => q.id === items.find(item => item.question.source === 'ai').question_id);
  assert.ok(aiQuestion.answer_latex);
  assert.equal(aiQuestion.generator_meta_json.approach_raw, '直接计算。');
  const submit = await call(handle, `/api/papers/${job.body.paper.id}/submit`, { method: 'POST', key: key(), body: {
    device_id: device,
    answers: items.map(item => ({ question_id: item.question.id, answer_raw: inferAnswer(runtime, item.question.id) })),
  } });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal(submit.body.score_x2, submit.body.max_score_x2);
  assert.ok(submit.body.attempts.every(attempt => attempt.correct_answer));
  const metrics = await call(handle, '/api/metrics/current');
  const recent = metrics.body.recent_papers.find(paper => paper.id === job.body.paper.id);
  assert.ok(recent);
  const preview = await call(handle, `/api/metrics/papers/${recent.id}`);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.items.length, 4);
  assert.equal('device_id' in preview.body, false);
  assert.ok(preview.body.items.every(item => item.question.answer_latex === undefined));
});
test('wrong-book variants form a paper, track mastery and unlock deletion', async () => {
  const runtime = createLocalRuntime();
  const handle = application(runtime);
  const knowledge = (await call(handle, '/api/knowledge')).body.items;
  const node = knowledge.find(n => n.code === 'GS1');
  const compose = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
    device_id: device, concept_node_ids: [node.id], qtypes: ['single_choice'], count: 1,
    source_mode: 'real', mode: 'drill', difficulty: 'medium',
  } });
  assert.equal(compose.status, 201, JSON.stringify(compose.body));
  const wrongQuestion = compose.body.items[0].question;
  const correct = runtime.questions.find(q => q.id === wrongQuestion.id).answer_latex;
  const wrong = correct === 'A' ? 'B' : 'A';
  await call(handle, `/api/papers/${compose.body.paper_instance_id}/submit`, { method: 'POST', key: key(), body: {
    device_id: device, answers: [{ question_id: wrongQuestion.id, answer_raw: wrong }],
  } });
  const source = runtime.questions.find(q => q.id === wrongQuestion.id);
  let calls = 0;
  runtime.llm = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ items: [1, 2, 3].map(index => ({
      source_question_id: wrongQuestion.id, qtype: 'single_choice', stem_latex: `变式题干 ${index} $x$`,
      options: [{ label: 'A', latex: '$1$' }, { label: 'B', latex: '$2$' }, { label: 'C', latex: '$3$' }, { label: 'D', latex: '$4$' }],
      answer_latex: 'B', knowledge_code: source.knowledge[0].code, exam_point: '函数概念',
      difficulty: source.difficulty, explanation: '代入计算。', solution_steps: [],
    })) });
    return JSON.stringify({ answers: [1, 2, 3].map(index => ({ index, answer_latex: 'B' })) });
  };
  const queued = await call(handle, '/api/variants', { method: 'POST', key: key(), body: {
    device_id: device, items: [{ question_id: wrongQuestion.id, count: 3 }],
  } });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  let job;
  for (let i = 0; i < 4; i += 1) {
    job = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
    if (job.body.status === 'succeeded' || job.body.status === 'failed') break;
  }
  assert.equal(job.body.status, 'succeeded', JSON.stringify(job.body));
  assert.equal(job.body.paper.items_json.length, 3);
  assert.equal(job.body.paper.origin, 'variant');
  assert.ok(job.body.paper.title.includes('错题仿真'));
  const blocked = await call(handle, `/api/wrong-book/${wrongQuestion.id}`, { method: 'DELETE', body: { device_id: device } });
  assert.equal(blocked.status, 409);
  const answers = job.body.paper.items_json.map(item => ({
    question_id: item.question.id,
    answer_raw: runtime.questions.find(q => q.id === item.question.id).answer_latex,
  }));
  const submit = await call(handle, `/api/papers/${job.body.paper.id}/submit`, { method: 'POST', key: key(), body: { device_id: device, answers } });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  const mastered = (await call(handle, '/api/wrong-book')).body.items[0].variant_stats;
  assert.equal(mastered.total, 3);
  assert.equal(mastered.correct, 3);
  assert.equal(mastered.mastered, true);
  assert.equal(mastered.rate_bp, 10000);
  const history = (await call(handle, '/api/papers')).body.items.find(paper => paper.id === job.body.paper.id);
  assert.equal(history.origin, 'variant');
  assert.ok(history.title.includes('错题仿真'));
  const deleted = await call(handle, `/api/wrong-book/${wrongQuestion.id}`, { method: 'DELETE', body: { device_id: device } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal((await call(handle, '/api/wrong-book')).body.items.length, 0);
});
test('variant jobs reuse matching AI questions before generating replacements', async () => {
  const runtime = createLocalRuntime({ random: () => 0.1 });
  const source = runtime.questions.find(question => question.source === 'real' && question.qtype === 'single_choice');
  runtime.wrongBook.push({ device_id: device, question_id: source.id, mastery: 0, next_review_at: new Date().toISOString() });
  const makeVariant = (confidence, suffix) => ({
    id: crypto.randomUUID(), seq_label: '变式', year: null, section: 'choice', qtype: source.qtype,
    stem_latex: `复用变式 ${suffix}`, options_json: source.options_json, sub_items_json: null,
    answer_latex: source.answer_latex, answer_source: 'ai_verified', solution_latex: null,
    score_x2: source.score_x2, difficulty: source.difficulty, source: 'ai',
    difficulty_source: 'variant_of_wrong', generator_meta_json: { variant_of: source.id, exam_point_raw: '函数概念', solution_steps: [] },
    rubric_json: null, rubric_version: null, content_hash: `variant-reuse-${suffix}`, status: 'published', is_fixture: false,
    knowledge: source.knowledge, confidence,
  });
  const high = makeVariant(90, '高');
  const middle = makeVariant(50, '中');
  const exhausted = makeVariant(0, '低');
  runtime.questions.push(high, middle, exhausted);
  const handle = application(runtime);
  const queued = await call(handle, '/api/variants', { method: 'POST', key: key(), body: {
    device_id: device, items: [{ question_id: source.id, count: 3 }],
  } });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  const planned = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
  assert.equal(planned.body.status, 'verifying');
  assert.equal(planned.body.reused_count, 3);
  assert.equal(planned.body.generated_count, 0);
  const completed = await call(handle, `/api/jobs/${queued.body.job_id}/step`, { method: 'POST', body: {} });
  assert.equal(completed.body.status, 'succeeded', JSON.stringify(completed.body));
  assert.deepEqual(completed.body.paper.items_json.map(item => item.question_id), [high.id, middle.id, exhausted.id]);
  assert.equal(runtime.questions.find(question => question.id === high.id).confidence, 89);
  assert.equal(runtime.questions.find(question => question.id === middle.id).confidence, 49);
  assert.equal(runtime.questions.find(question => question.id === exhausted.id).confidence, 0);
});

test('local SQLite restores generated questions, papers, attempts and wrong book', () => {
  const file = path.join(os.tmpdir(), `kaoyan-state-${crypto.randomUUID()}.db`);
  const runtime = createLocalRuntime();
  const baseCount = runtime.questions.length;
  const persistence = createPersistence(runtime, file);
  const generated = {
    id: crypto.randomUUID(), source: 'ai', is_fixture: false, qtype: 'single_choice',
    stem_latex: '变式题', options_json: [], answer_latex: 'B', knowledge: [{ code: 'GS1' }],
    generator_meta_json: { variant_of: 'source-question' }, status: 'published', confidence: 37,
  };
  runtime.questions.push(generated);
  const paper = {
    id: crypto.randomUUID(), device_id: device, status: 'submitted',
    items_json: [{ question_id: generated.id, question: generated, score_x2: 10 }],
    total_score_x2: 10, created_at: new Date().toISOString(),
  };
  runtime.papers.push(paper);
  runtime.attempts.push({
    id: crypto.randomUUID(), device_id: device, paper_instance_id: paper.id,
    question_id: generated.id, score_x2: 10, max_score_x2: 10, created_at: new Date().toISOString(),
  });
  runtime.wrongBook.push({ device_id: device, question_id: 'source-question', attempt_id: 'a1', mastery: 0 });
  runtime.dailyQuestions.set(`${device}:2026-11-20`, {
    device_id: device, date: '2026-11-20', question_id: generated.id,
    reason: { code: 'new_question', text: '建立基线' }, paper_id: paper.id,
    ai_messages: [{ role: 'assistant', content: '先看定义。' }], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  runtime.composeStats.success = 3;
  runtime.composeStats.failure = 1;
  runtime.deviceSessions.set(device, { token: 'persisted-token', expires_at: '2999-01-01' });
  runtime.aiSettings.set(device, {
    device_id: device, base_url: 'https://api.example.com/v1', api_key: 'sk-persisted-1234',
    model: 'persisted-model', updated_at: new Date().toISOString(),
  });
  const day = new Date().toISOString().slice(0, 10);
  runtime.usage.set(`${device}:${day}`, 7);
  runtime.generatedToday = 7;
  try {
    persistence.save();
    const db = new DatabaseSync(file);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM papers').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM generated_questions').get().count, 1);
    db.close();
    const restored = createLocalRuntime();
    createPersistence(restored, file).load();
    assert.equal(restored.questions.length, baseCount + 1);
    assert.equal(restored.questions.filter(question => question.id === generated.id).length, 1);
    assert.equal(restored.questions.find(question => question.id === generated.id).confidence, 37);
    assert.equal(restored.papers.length, 1);
    assert.equal(restored.attempts.length, 1);
    assert.equal(restored.wrongBook.length, 1);
    assert.equal(restored.dailyQuestions.get(`${device}:2026-11-20`).question_id, generated.id);
    assert.equal(restored.dailyQuestions.get(`${device}:2026-11-20`).ai_messages[0].content, '先看定义。');
    assert.equal(restored.composeStats.success, 3);
    assert.equal(restored.composeStats.failure, 1);
    assert.equal(restored.deviceSessions.get(device).token, 'persisted-token');
    assert.equal(restored.aiSettings.get(device).api_key, 'sk-persisted-1234');
    assert.equal(restored.aiSettings.get(device).model, 'persisted-model');
    assert.equal(restored.usage.get(`${device}:${day}`), 7);
    assert.equal(restored.generatedToday, 7);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});
test('AI settings are tested before saving and drive AI compose', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) });
  const runtime = createLocalRuntime();
  const handle = application(runtime);
  try {
    const before = await call(handle, '/api/ai-settings');
    assert.equal(before.body.configured, false);
    const node = (await call(handle, '/api/knowledge')).body.items.find(n => n.code === 'GS1').id;
    const blocked = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
      device_id: device, concept_node_ids: [node], count: 1, type_counts: { single_choice: 1 },
      source_mode: 'ai', mode: 'drill', difficulty: 'medium',
    } });
    assert.equal(blocked.status, 409);
    const saved = await call(handle, '/api/ai-settings', { method: 'POST', key: key(), body: {
      device_id: device, base_url: 'https://api.example.com/v1/chat/completions',
      api_key: 'sk-test-1234', model: 'test-model',
    } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.configured, true);
    assert.equal(saved.body.settings.base_url, 'https://api.example.com/v1');
    assert.equal(saved.body.settings.key_hint, '••••1234');
    assert.equal('api_key' in saved.body.settings, false);
    const after = await call(handle, '/api/ai-settings');
    assert.equal(after.body.configured, true);
    assert.equal(after.body.model, 'test-model');
    const queued = await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: {
      device_id: device, concept_node_ids: [node], count: 1, type_counts: { single_choice: 1 },
      source_mode: 'ai', mode: 'drill', difficulty: 'medium',
    } });
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('Agent separates profile, preferences and inference and executes real tools', async () => {
  const runtime = createLocalRuntime();
  const handle = application(runtime);
  const saved = await call(handle, '/api/agent/profile', { method: 'POST', key: key(), body: {
    device_id: device, exam_year: 2027, target_score: 120, foundation: '一般', stage: '强化', weekly_minutes: 600,
  } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const preferences = await call(handle, '/api/agent/preferences', { method: 'POST', key: key(), body: {
    device_id: device, source_mode: 'real', question_count: 8, difficulty: 'hard',
  } });
  assert.equal(preferences.status, 200, JSON.stringify(preferences.body));
  const state = await call(handle, '/api/agent/state');
  assert.equal(state.body.user_profile.exam_year, 2027);
  assert.equal(state.body.preferences.question_count, 8);
  assert.equal(state.body.agent_summary.source, 'agent_inference');
  const { executeAgentTool } = await import('../functions/agent-tools.mjs');
  const wrong = runtime.questions.find(q => q.source === 'real' && q.qtype === 'single_choice');
  runtime.wrongBook.push({ device_id: device, question_id: wrong.id, attempt_id: null, mastery: 0, next_review_at: new Date(Date.now() - 1000).toISOString() });
  const wrongList = await executeAgentTool(runtime, device, 'list_wrong_questions', { limit: 5 });
  assert.equal(wrongList.ok, true);
  assert.equal(wrongList.data[0].question_id, wrong.id);
  const detail = await executeAgentTool(runtime, device, 'get_question_detail', { question_id: wrong.id });
  assert.ok(detail.data.answer);
  const nodes = await executeAgentTool(runtime, device, 'list_knowledge_nodes', { query: '函数', limit: 5 });
  assert.ok(nodes.data.length > 0);
  assert.ok(nodes.data[0].id);
  const context = buildAgentContext(runtime, device, { messages: [{ role: 'user', content: '帮我安排复习' }] }, '帮我安排复习');
  assert.ok(context.messages[0].content.includes('用户明确填写的档案'));
  assert.ok(context.messages[0].content.includes('Agent 自己总结的档案'));
  assert.ok(context.messages[0].content.includes('用户偏好'));
  assert.ok(context.messages.at(-1).content.includes('Asia/Shanghai'));
  assert.ok(context.stats.input_budget > 0);
  assert.equal(resolveModelProfile('unknown-model').known, false);
});
test('Agent tasks call tools and persist completed plans', async () => {
  const runtime = createLocalRuntime();
  let calls = 0;
  runtime.llm = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ action: 'tool', tool: 'list_wrong_questions', args: { limit: 3 }, reply: '正在查看错题' });
    if (calls === 2) return JSON.stringify({ action: 'tool', tool: 'create_study_plan', args: { title: '今日复习', goal: '巩固薄弱点', items: [{ title: '复习错题', minutes: 30 }], confirmed: true }, reply: '正在保存计划' });
    return JSON.stringify({ action: 'respond', reply: '已安排今日复习', summary_update: '用户正在巩固错题。' });
  };
  const handle = application(runtime);
  await call(handle, '/api/agent/profile', { method: 'POST', key: key(), body: { device_id: device, exam_year: 2026, foundation: '一般', stage: '强化' } });
  const task = await call(handle, '/api/agent/tasks', { method: 'POST', key: key(), body: { device_id: device, goal: '帮我安排今天的复习' } });
  assert.equal(task.status, 202, JSON.stringify(task.body));
  let current;
  for (let index = 0; index < 6; index += 1) {
    current = await call(handle, `/api/agent/tasks/${task.body.id}/step`, { method: 'POST', body: {} });
    if (['succeeded', 'failed', 'waiting_user', 'degraded'].includes(current.body.status)) break;
  }
  assert.equal(current.body.status, 'succeeded', JSON.stringify(current.body));
  assert.equal(current.body.result.reply, '已安排今日复习');
  assert.equal(current.body.steps.length, 2);
  assert.equal(current.body.steps[0].tool, 'list_wrong_questions');
  const state = await call(handle, '/api/agent/state');
  assert.equal(state.body.plans.length, 1);
  assert.equal(state.body.agent_summary.text, '用户正在巩固错题。');
  const file = path.join(os.tmpdir(), `agent-state-${crypto.randomUUID()}.db`);
  try {
    createPersistence(runtime, file).save();
    const restored = createLocalRuntime();
    createPersistence(restored, file).load();
    assert.equal(restored.agentStates.get(device).plans.length, 1);
    assert.equal(restored.agentStates.get(device).agent_summary, '用户正在巩固错题。');
    assert.equal(restored.agentStates.get(device).profile.exam_year, 2026);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
});
test('Agent waits for confirmation and resumes the same task', async () => {
  const runtime = createLocalRuntime();
  let calls = 0;
  runtime.llm = async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ action: 'ask', reply: '要生成 6 道练习卷吗？', requires_confirmation: true });
    return JSON.stringify({ action: 'respond', reply: '已按确认结果执行。' });
  };
  const handle = application(runtime);
  const created = await call(handle, '/api/agent/tasks', { method: 'POST', key: key(), body: { device_id: device, goal: '生成练习卷' } });
  const waiting = await call(handle, `/api/agent/tasks/${created.body.id}/step`, { method: 'POST', body: {} });
  assert.equal(waiting.body.status, 'waiting_user');
  const confirmed = await call(handle, `/api/agent/tasks/${created.body.id}/confirm`, { method: 'POST', body: { approve: true } });
  assert.equal(confirmed.body.status, 'queued');
  assert.equal(confirmed.body.id, created.body.id);
  const done = await call(handle, `/api/agent/tasks/${created.body.id}/step`, { method: 'POST', body: {} });
  assert.equal(done.body.status, 'succeeded', JSON.stringify(done.body));
  assert.equal(done.body.id, created.body.id);
  const state = await call(handle, '/api/agent/state');
  assert.equal(state.body.tasks[0].id, created.body.id);
});
test('Agent receives async job failure and can continue with a new plan', async () => {
  const runtime = createLocalRuntime();
  runtime.llm = async () => JSON.stringify({ action: 'respond', reply: '生成失败，我改用真题重新安排。' });
  const handle = application(runtime);
  const created = await call(handle, '/api/agent/tasks', { method: 'POST', key: key(), body: { device_id: device, goal: '生成一份 AI 仿真卷' } });
  const task = runtime.agentStates.get(device).tasks.find(item => item.id === created.body.id);
  task.pending_job = { id: 'failed-job-0001', tool: 'compose_paper' };
  runtime.jobs.push({ id: 'failed-job-0001', device_id: device, kind: 'paper', status: 'failed', error: 'ai_blind_solve_mismatch' });
  const failed = await call(handle, `/api/agent/tasks/${task.id}/step`, { method: 'POST', body: {} });
  assert.equal(failed.body.status, 'queued');
  assert.equal(failed.body.stage, '组卷失败，正在调整方案');
  assert.ok(failed.body.context_state.tool_results.some(item => item.ok === false && item.summary.includes('盲解')));
  const continued = await call(handle, `/api/agent/tasks/${task.id}/step`, { method: 'POST', body: {} });
  assert.equal(continued.body.status, 'succeeded', JSON.stringify(continued.body));
  assert.ok(continued.body.result.reply.includes('真题'));
});
test('idempotency, quotas and limits are enforced', async () => {
  const runtime = createLocalRuntime();
  runtime.llm = async () => '{}';
  const handle = application(runtime);
  const node = (await call(handle, '/api/knowledge')).body.items.find(n => n.code === 'GS1').id;
  const payload = { concept_node_ids: [node], qtypes: ['single_choice'], count: 1, source_mode: 'real', mode: 'drill', difficulty: 'medium', device_id: device };
  const sameKey = key();
  const first = await call(handle, '/api/papers/compose', { method: 'POST', key: sameKey, body: payload });
  const second = await call(handle, '/api/papers/compose', { method: 'POST', key: sameKey, body: payload });
  assert.equal(first.body.paper_instance_id, second.body.paper_instance_id);
  assert.equal((await call(handle, '/api/papers/compose', { method: 'POST', key: sameKey, body: { ...payload, count: 2 } })).status, 409);
  assert.equal((await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: { ...payload, count: 31 } })).status, 400);
  assert.equal((await call(handle, '/api/papers/compose', { method: 'POST', key: key(), body: { ...payload, source_mode: 'ai', count: 1 } })).status, 202);
});
test('mixed mode honors both source targets', () => {
  const runtime = createLocalRuntime();
  const node = runtime.knowledge.find(n => n.code === 'GS');
  const paper = composePaper({
    device_id: device, concept_node_ids: [node.id], qtypes: ['single_choice', 'fill_blank'], count: 4,
    source_mode: 'mixed', mode: 'exam', difficulty: 'medium',
  }, runtime);
  assert.deepEqual(paper.actual_ratio, { real: 2, ai: 2 });
  assert.equal(paper.items_json.filter(item => item.question.source === 'ai').length, 2);
});

test('report hides an AI question immediately and metrics stay aggregate', async () => {
  const runtime = createLocalRuntime(), handle = application(runtime);
  const question = { ...runtime.questions.find(q => q.source === 'ai'), id: crypto.randomUUID(), is_fixture: false };
  runtime.questions.push(question);
  const before = (await call(handle, '/api/metrics/current')).body.question_bank.ai;
  const report = await call(handle, `/api/questions/${question.id}/reports`, { method: 'POST', key: key(), body: { device_id: device, reason: 'wrong_answer' } });
  assert.equal(report.status, 201);
  assert.equal(question.status, 'pending_review');
  const metrics = await call(handle, '/api/metrics/current');
  assert.equal(metrics.body.question_bank.ai, before - 1);
  assert.equal('device_id' in metrics.body, false);
  assert.ok(Array.isArray(metrics.body.metrics));
  assert.ok('compose' in metrics.body);
  assert.ok(Array.isArray(metrics.body.recent_papers));
});
test('writes require a server-issued session token', async () => {
  const handle = application(createLocalRuntime());
  const node = (await call(handle, '/api/knowledge')).body.items[0].id;
  const response = await raw(handle, '/api/papers/compose', { method: 'POST', headers: { 'idempotency-key': key() }, body: {
    device_id: device, concept_node_ids: [node], qtypes: ['single_choice'], count: 1, source_mode: 'real', mode: 'drill', difficulty: 'easy',
  } });
  assert.equal(response.status, 401);
});

test('daily question prioritizes due weak questions and remains fixed for the day', async () => {
  const runtime = createLocalRuntime();
  const candidate = runtime.questions.find(question => question.source === 'real' && !question.is_fixture && question.qtype === 'single_choice' && question.status === 'published');
  assert.ok(candidate);
  runtime.wrongBook.push({
    device_id: device, question_id: candidate.id, attempt_id: null,
    attempt_history_json: [], mastery: 0, next_review_at: new Date(Date.now() - 1000).toISOString(),
    review_count: 0, last_result: 'wrong',
  });
  const handle = application(runtime);
  const first = await call(handle, '/api/daily-question');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.question.id, candidate.id);
  assert.equal(first.body.status, 'available');
  assert.equal(first.body.question.answer_latex, undefined);
  assert.equal(first.body.reason.code, 'due_review');
  const second = await call(handle, '/api/daily-question');
  assert.equal(second.body.question.id, first.body.question.id);
  const expectedAnswer = inferAnswer(runtime, candidate.id);
  const invalid = await call(handle, '/api/daily-question/submit', { method: 'POST', key: key(), body: {
    question_id: candidate.id, answer_raw: expectedAnswer, duration_sec: -1, confirmed_latex: {},
  } });
  assert.equal(invalid.status, 400);
  runtime.questions = runtime.questions.filter(question => question.id !== candidate.id);
  const submitted = await call(handle, '/api/daily-question/submit', { method: 'POST', key: key(), body: {
    question_id: candidate.id, answer_raw: expectedAnswer, duration_sec: 0,
  } });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.status, 'submitted');
  assert.equal(submitted.body.result.attempts.length, 1);
  assert.equal(submitted.body.result.attempts[0].correct_answer, expectedAnswer);
  assert.equal(runtime.attempts.at(-1).duration_sec, 0);
  const refreshed = await call(handle, '/api/daily-question');
  assert.equal(refreshed.body.question.id, candidate.id);
  assert.equal(refreshed.body.status, 'submitted');
  assert.equal(refreshed.body.result.score_rate_bp, 10000);
  const afterReport = await call(handle, '/api/daily-question');
  assert.equal(afterReport.body.question.id, candidate.id);
  assert.equal(afterReport.body.status, 'submitted');
});

test('daily question uses the configured AI provider for explanation and follow-up', async () => {
  const prompts = [];
  const runtime = createLocalRuntime({ llm: async messages => {
    prompts.push(messages.at(-1).content);
    return `针对你的作答给出建议（第 ${prompts.length} 次）。`;
  } });
  const handle = application(runtime);
  const daily = await call(handle, '/api/daily-question');
  const questionId = daily.body.question.id;
  const submitted = await call(handle, '/api/daily-question/submit', { method: 'POST', key: key(), body: {
    question_id: questionId, answer_raw: inferAnswer(runtime, questionId),
  } });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const explanation = await call(handle, '/api/daily-question/explain', { method: 'POST', key: key(), body: {
    prompt: '请再提醒我一个容易错的地方。',
  } });
  assert.equal(explanation.status, 200, JSON.stringify(explanation.body));
  assert.equal(explanation.body.ai_messages.at(-1).role, 'assistant');
  assert.ok(explanation.body.ai_messages.at(-1).content.includes('第 1 次'));
  const followUp = await call(handle, '/api/daily-question/explain', { method: 'POST', key: key(), body: {
    prompt: '为什么这个步骤重要？',
  } });
  assert.equal(followUp.status, 200, JSON.stringify(followUp.body));
  assert.equal(followUp.body.ai_messages.filter(message => message.role === 'assistant').length, 2);
  assert.equal(prompts.length, 2);
});

test('daily AI explanation shares one in-flight result for a repeated idempotency key', async () => {
  let calls = 0;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  let release;
  const releasePromise = new Promise(resolve => { release = resolve; });
  const runtime = createLocalRuntime({ llm: async () => {
    calls += 1;
    entered();
    await releasePromise;
    return '同一请求只生成一次。';
  } });
  const handle = application(runtime);
  const daily = await call(handle, '/api/daily-question');
  await call(handle, '/api/daily-question/submit', { method: 'POST', key: key(), body: {
    question_id: daily.body.question.id, answer_raw: inferAnswer(runtime, daily.body.question.id),
  } });
  const sameKey = key();
  const first = call(handle, '/api/daily-question/explain', { method: 'POST', key: sameKey, body: { prompt: '讲解' } });
  await enteredPromise;
  const second = call(handle, '/api/daily-question/explain', { method: 'POST', key: sameKey, body: { prompt: '讲解' } });
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(two.status, 200, JSON.stringify(two.body));
  assert.equal(calls, 1);
  assert.deepEqual(one.body.ai_messages, two.body.ai_messages);
});

test('daily question selection persists after a read-only creation', async () => {
  const file = path.join(os.tmpdir(), `daily-question-${crypto.randomUUID()}.db`);
  const runtime = createLocalRuntime();
  const daily = await call(application(runtime), '/api/daily-question');
  assert.equal(runtime.dailyQuestionsDirty, true);
  try {
    createPersistence(runtime, file).save();
    const restored = createLocalRuntime();
    createPersistence(restored, file).load();
    const record = restored.dailyQuestions.get(`${device}:${daily.body.date}`);
    assert.equal(record.question_id, daily.body.question.id);
    assert.ok(record.question_snapshot.answer_latex);
    assert.equal(record.reason.code, daily.body.reason.code);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});
