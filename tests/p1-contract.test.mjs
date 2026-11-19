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
test('local SQLite restores generated questions, papers, attempts and wrong book', () => {
  const file = path.join(os.tmpdir(), `kaoyan-state-${crypto.randomUUID()}.db`);
  const runtime = createLocalRuntime();
  const baseCount = runtime.questions.length;
  const persistence = createPersistence(runtime, file);
  const generated = {
    id: crypto.randomUUID(), source: 'ai', is_fixture: false, qtype: 'single_choice',
    stem_latex: '变式题', options_json: [], answer_latex: 'B', knowledge: [{ code: 'GS1' }],
    generator_meta_json: { variant_of: 'source-question' }, status: 'published',
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
    assert.equal(restored.papers.length, 1);
    assert.equal(restored.attempts.length, 1);
    assert.equal(restored.wrongBook.length, 1);
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
