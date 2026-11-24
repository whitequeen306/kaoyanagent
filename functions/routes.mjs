import { AppError, fail, assertDeviceId, uuid, nowIso } from './model.mjs';
import { composePaper } from './compose.mjs';
import { gradeSubmission, submissionSummary, publicQuestion, reviewQuestion } from './grade.mjs';
import { listWrongBook, todayReview, similarQuestions, variantMastery } from './review.mjs';
import { findRepairCase, listRepairCases, getDailyRepair, replaceDailyRepair, repairCaseView, syncRepairForPaper } from './repair.mjs';
import { currentMetrics, metricTrends } from './metrics.mjs';
import { checkQuota } from './runtime.mjs';
import { advancePaperJob, advanceVariantJob, createPaperJob, createVariantJob, discardJob, ensureJobCanStart } from './generate.mjs';
import { publicAiSettings, saveAiSettings, settingsFor } from './ai-settings.mjs';
import { getAgentState, saveProfile, savePreferences, saveAgentSummary, clearAgentSummary, updateStudyPlan } from './agent-store.mjs';
import { advanceAgentTask, confirmAgentTask, createAgentTask, publicAgentTask } from './agent.mjs';
import { dailyJudgment, getDailyQuestion, generateDailyAiReply, submitDailyAnswer } from './daily-question.mjs';
import { clearCs408Agent, cs408AgentReply, publicCs408Agent, saveCs408Profile } from './cs408-agent.mjs';
import { createMathExamPaper, listMathExamYears } from './math-exams.mjs';
import { advanceCs408PaperJob, createCs408PaperJob } from './cs408-generate.mjs';
import { createImageAsset } from './image-assets.mjs';
import { recognizeAnswer } from './recognition.mjs';
import { createCs408Paper, createCs408PracticePaper, cs408Metrics, cs408NodeQuestionCount, cs408PaperView, ensureCs408RepairCases, gradeCs408Submission, listCs408History, listCs408RepairCases, listCs408WrongBook, listCs408Years } from './cs408.mjs';

function json(value, status = 200) { return Response.json(value, { status }); }
function paperView(paper) { const { device_id, ...rest } = paper; return rest; }
function readableRepairTitle(paper, runtime) {
  const sourceId = paper.config_json?.variant_items?.[0]?.question_id
    || paper.items_json?.[0]?.question?.generator_meta_json?.variant_of;
  const source = sourceId ? runtime.questions.find(question => question.id === sourceId) : null;
  if (source?.year) return `AI 修复 · ${source.year} 真题 · 第 ${source.seq_label} 题`;
  if (source?.generator_meta_json?.exam_point_raw) return `AI 修复 · ${source.generator_meta_json.exam_point_raw}`;
  if (paper.title && !/[$\\]/.test(paper.title)) return paper.title;
  return 'AI 修复练习';
}
function jobView(job) {
  return {
    id: job.id, status: job.status, stage: job.stage, progress: job.progress,
    phase: job.phase || null, detail: job.detail || '',
    expected_count: job.expected_count || 0,
    generated_count: job.generated_count || 0,
    verified_count: job.verified_count || 0,
    reused_count: job.reused_count || 0,
    error: job.error || null,
    diagnosis: job.diagnosis || null,
    repair_case_id: job.config?.repair_case_id || null,
    paper: job.paper ? paperView(job.paper) : null,
  };
}
async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail('invalid_input');
  let value;
  try { value = await request.json(); } catch { fail('invalid_input'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_input');
  return value;
}
async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function idempotent(runtime, request, deviceId, action, input, work) {
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[a-zA-Z0-9_-]{12,128}$/.test(key)) fail('invalid_input');
  const scoped = `${deviceId}:${action}:${key}`;
  const previous = runtime.idempotency.get(scoped);
  if (previous) {
    if (JSON.stringify(previous.input) !== JSON.stringify(input)) fail('idempotency_conflict', 409);
    return previous.response;
  }
  const response = work();
  runtime.idempotency.set(scoped, { input, response });
  return response;
}
async function asyncIdempotent(runtime, request, deviceId, action, input, work) {
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[a-zA-Z0-9_-]{12,128}$/.test(key)) fail('invalid_input');
  const scoped = `${deviceId}:${action}:${key}`;
  const previous = runtime.idempotency.get(scoped);
  if (previous) {
    if (JSON.stringify(previous.input) !== JSON.stringify(input)) fail('idempotency_conflict', 409);
    return previous.response;
  }
  const inflight = runtime.idempotencyInflight ||= new Map();
  const pending = inflight.get(scoped);
  if (pending) {
    if (JSON.stringify(pending.input) !== JSON.stringify(input)) fail('idempotency_conflict', 409);
    return pending.promise;
  }
  const promise = Promise.resolve().then(work);
  inflight.set(scoped, { input, promise });
  try {
    const response = await promise;
    runtime.idempotency.set(scoped, { input, response });
    return response;
  } finally {
    if (inflight.get(scoped)?.promise === promise) inflight.delete(scoped);
  }
}
async function serial(runtime, queueKey, work) {
  const queues = runtime.dailySubmitQueues ||= new Map();
  const previous = queues.get(queueKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  queues.set(queueKey, current);
  try { return await current; }
  finally { if (queues.get(queueKey) === current) queues.delete(queueKey); }
}
function requireSession(runtime, request, deviceId) {
  const token = request.headers.get('x-device-token');
  const session = runtime.deviceSessions.get(deviceId);
  if (!token || !session || session.token !== token || session.expires_at < nowIso()) fail('unauthorized_device', 401);
}
function publicAttempt(attempt) {
  return {
    question_id: attempt.question_id, score_x2: attempt.score_x2, max_score_x2: attempt.max_score_x2,
    score_rate_bp: attempt.score_rate_bp, feedback: attempt.feedback || null,
    grading_status: attempt.grading_status, error_tags_json: attempt.error_tags_json,
    answer_raw: attempt.answer_raw, confirmed_latex: attempt.confirmed_latex || null,
  };
}
function paperResult(paper, runtime) {
  const attempts = runtime.attempts.filter(attempt => attempt.paper_instance_id === paper.id);
  return {
    attempts: attempts.map(attempt => {
      const question = runtime.questions.find(q => q.id === attempt.question_id)
        || paper.items_json.find(item => item.question_id === attempt.question_id)?.question;
      return { ...publicAttempt(attempt), ...(question ? reviewQuestion(question) : {}) };
    }),
    ...submissionSummary(paper, attempts), diagnosis: null,
  };
}
function publicDailyQuestion(question) {
  const view = publicQuestion(question);
  const { score_x2, score_source, ...rest } = view;
  return {
    ...rest,
    sub_items_json: view.sub_items_json?.map(({ score_x2: _score, ...item }) => item) || null,
  };
}
function dailyQuestionView(runtime, deviceId, daily = getDailyQuestion(runtime, deviceId)) {
  const judgment = dailyJudgment(runtime, daily);
  return {
    date: daily.record.date,
    status: judgment && !judgment.retryable ? 'submitted' : 'available',
    reason: daily.record.reason,
    question: publicDailyQuestion(daily.question),
    result: judgment ? {
      correct: judgment.correct,
      feedback: judgment.feedback || '',
      retryable: judgment.retryable === true,
      answer_kind: judgment.answer_kind || 'text',
      grading_status: judgment.grading_status || 'completed',
      answer_raw: judgment.answer_raw || null,
      in_wrong_book: !judgment.retryable && runtime.wrongBook.some(item => item.device_id === deviceId && item.question_id === daily.question.id),
      review: !judgment.retryable && typeof judgment.correct === 'boolean' ? reviewQuestion(daily.question) : null,
    } : null,
    ai_messages: daily.record.ai_messages || [],
  };
}
function repairDailyPayload(deviceId, runtime) {
  const daily = getDailyRepair(deviceId, runtime);
  return {
    date: daily.date, backlog_count: daily.backlog_count,
    items: daily.items.map(item => ({ ...item, question: item.question ? publicQuestion(item.question) : null })),
  };
}

export function application(runtime) {
  return async request => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})/, '') || '/';
    if (path === '/api/health' && request.method === 'GET') return json({ ok: true, mode: 'local' });
    const input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await body(request);
    let match;
    const deviceId = input.device_id || request.headers.get('x-device-id');
    assertDeviceId(deviceId);
    if (path === '/api/session' && request.method === 'POST') {
      const token = crypto.randomUUID().replaceAll('-', '');
      const expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
      runtime.deviceSessions.set(deviceId, { token, expires_at });
      return json({ token, expires_at }, 201);
    }
    if (request.method !== 'GET') requireSession(runtime, request, deviceId);
    if (path === '/api/knowledge' && request.method === 'GET') {
      return json({ items: runtime.knowledge.map(n => ({ id: n.id, parent_id: n.parent_id, code: n.code, name: n.name, level: n.level, aliases: n.aliases })) });
    }
    if (path === '/api/cs408/knowledge' && request.method === 'GET') {
      return json({ items: runtime.cs408Knowledge.map(n => {
        const single = cs408NodeQuestionCount(runtime, n, 'single_choice');
        const free = cs408NodeQuestionCount(runtime, n, 'free_response');
        return {
          id: n.id, parent_id: n.parent_id, code: n.code, name: n.name, level: n.level, aliases: n.aliases,
          question_count: single + free, single_choice_count: single, free_response_count: free,
        };
      }) });
    }
    if (path === '/api/cs408/papers' && request.method === 'GET') {
      return json({ items: listCs408Years(runtime, deviceId) });
    }
    if (path === '/api/cs408/history' && request.method === 'GET') {
      return json({ items: listCs408History(runtime, deviceId) });
    }
    if (path === '/api/cs408/metrics' && request.method === 'GET') {
      return json(cs408Metrics(runtime, deviceId));
    }
    if (path === '/api/cs408/agent' && request.method === 'GET') {
      return json(publicCs408Agent(runtime, deviceId));
    }
    if (path === '/api/cs408/agent/profile' && request.method === 'POST') {
      return json({ profile: saveCs408Profile(runtime, deviceId, input) });
    }
    if (path === '/api/cs408/agent/chat' && request.method === 'POST') {
      if (typeof input.message !== 'string') fail('invalid_input');
      const response = await asyncIdempotent(runtime, request, deviceId, 'cs408-agent-chat', input, () => cs408AgentReply(runtime, deviceId, input));
      return json(response);
    }
    if (path === '/api/cs408/agent/clear' && request.method === 'POST') {
      return json(clearCs408Agent(runtime, deviceId));
    }
    if (path === '/api/cs408/papers' && request.method === 'POST') {
      if (!Number.isInteger(input.year)) fail('invalid_input');
      const response = idempotent(runtime, request, deviceId, `cs408-create:${input.year}:${input.restart === true}`, input, () => {
        const paper = createCs408Paper(runtime, deviceId, input.year, input.restart === true);
        return cs408PaperView(paper, runtime);
      });
      return json(response, 201);
    }
    if (path === '/api/cs408/practice/ai' && request.method === 'POST') {
      const result = idempotent(runtime, request, deviceId, 'cs408-practice-ai', input, () => {
        const job = createCs408PaperJob(runtime, input, deviceId);
        ensureJobCanStart(runtime, job);
        if (!checkQuota(runtime, deviceId, 2)) {
          discardJob(runtime, job);
          fail('quota_exceeded', 429);
        }
        return { job_id: job.id, ...jobView(job) };
      });
      return json(result, 202);
    }
    if (path === '/api/cs408/practice' && request.method === 'POST') {
      const response = idempotent(runtime, request, deviceId, 'cs408-practice', input, () => {
        const paper = createCs408PracticePaper(runtime, deviceId, input.node_ids, input.count, {
          type_counts: input.type_counts,
          mode: input.mode,
          year_from: input.year_from,
          year_to: input.year_to,
          exclude_done: input.exclude_done,
        });
        return cs408PaperView(paper, runtime);
      });
      return json(response, 201);
    }
    match = path.match(/^\/api\/cs408\/papers\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'GET') {
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase() && p.device_id === deviceId && p.subject === 'cs408');
      if (!paper) fail('not_found', 404);
      return json(cs408PaperView(paper, runtime));
    }
    match = path.match(/^\/api\/cs408\/papers\/([0-9a-fA-F-]{36})\/submit$/);
    if (match && request.method === 'POST') {
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase() && p.device_id === deviceId && p.subject === 'cs408');
      if (!paper) fail('not_found', 404);
      if (!Array.isArray(input.answers) || input.answers.length > 100) fail('invalid_input');
      for (const answer of input.answers) {
        if (!answer || typeof answer.question_id !== 'string' || typeof (answer.answer_raw ?? '') !== 'string') fail('invalid_input');
        if (String(answer.answer_raw || '').length > 20000) fail('payload_too_large', 413);
      }
      const result = idempotent(runtime, request, deviceId, `cs408-submit:${paper.id}`, input, () => gradeCs408Submission(paper, { ...input, device_id: deviceId }, runtime));
      return json(result);
    }
    if (path === '/api/cs408/wrong-book' && request.method === 'GET') {
      return json({ items: listCs408WrongBook(deviceId, runtime) });
    }
    if (path === '/api/cs408/repair/today' && request.method === 'GET') {
      return json(listCs408RepairCases(deviceId, runtime));
    }
    match = path.match(/^\/api\/cs408\/repair\/questions\/([A-Za-z0-9_-]{1,64})\/generate$/);
    if (match && request.method === 'POST') {
      const questionId = match[1].toLowerCase();
      const question = runtime.questions.find(item => item.id === questionId && item.subject === 'cs408');
      if (!question) fail('not_found', 404);
      const repair = ensureCs408RepairCases(deviceId, runtime).find(item => item.question_id === questionId);
      if (!repair) fail('not_found', 404);
      if ((repair.repair_passes || 0) >= 5) fail('repair_completed', 409);
      const result = idempotent(runtime, request, deviceId, `cs408-repair:${questionId}`, input, () => {
        const job = createVariantJob(runtime, { items: [{ question_id: questionId, count: 3 }], repair_case_id: repair.id }, deviceId);
        ensureJobCanStart(runtime, job);
        if (!checkQuota(runtime, deviceId, 2)) {
          discardJob(runtime, job);
          fail('quota_exceeded', 429);
        }
        return { job_id: job.id, repair_case_id: repair.id, ...jobView(job) };
      });
      return json(result, 202);
    }
    if (path === '/api/ai-settings' && request.method === 'GET') {
      return json(publicAiSettings(settingsFor(runtime, deviceId)));
    }
    if (path === '/api/ai-settings' && request.method === 'POST') {
      return json(await saveAiSettings(runtime, deviceId, input, settingsFor(runtime, deviceId)));
    }
    if (path === '/api/daily-question' && request.method === 'GET') {
      return json(dailyQuestionView(runtime, deviceId));
    }
    if (path === '/api/daily-question/submit' && request.method === 'POST') {
      if (typeof input.question_id !== 'string') fail('invalid_input');
      if (input.answer_raw !== undefined && typeof input.answer_raw !== 'string') fail('invalid_input');
      if (input.confirmed_latex !== undefined && input.confirmed_latex !== null && typeof input.confirmed_latex !== 'string') fail('invalid_input');
      if (input.duration_sec !== undefined && input.duration_sec !== null
        && (!Number.isInteger(input.duration_sec) || input.duration_sec < 0)) fail('invalid_input');
      if (input.answer_raw?.length > 20000) fail('payload_too_large', 413);
      const answerRaw = (input.answer_raw || '').trim();
      if (!answerRaw && input.answer_image == null) fail('invalid_input');
      const daily = getDailyQuestion(runtime, deviceId);
      if (input.question_id !== daily.question.id || (input.date !== daily.record.date)) fail('state_conflict', 409);
      const responseInput = {
        question_id: input.question_id,
        answer_raw: answerRaw,
        confirmed_latex: input.confirmed_latex ?? null,
        duration_sec: input.duration_sec ?? null,
        answer_image: input.answer_image ? {
          mime_type: input.answer_image.mime_type,
          data_url_fingerprint: await fingerprint(input.answer_image.data_url),
        } : null,
      };
      const response = await asyncIdempotent(runtime, request, deviceId, `daily-submit:${daily.record.date}`, responseInput,
        () => serial(runtime, `${deviceId}:${daily.record.date}`, async () => {
          await submitDailyAnswer(runtime, daily, answerRaw, input.answer_image);
          return dailyQuestionView(runtime, deviceId, daily);
        }));
      return json(response);
    }
    if (path === '/api/daily-question/explain' && request.method === 'POST') {
      if (input.prompt !== undefined && typeof input.prompt !== 'string') fail('invalid_input');
      if (String(input.prompt || '').length > 1000) fail('payload_too_large', 413);
      const daily = getDailyQuestion(runtime, deviceId);
      if (input.date !== daily.record.date) fail('state_conflict', 409);
      const response = await asyncIdempotent(runtime, request, deviceId, `daily-explain:${daily.record.date}`, input, async () => {
        await generateDailyAiReply(runtime, deviceId, daily, input.prompt || '');
        return dailyQuestionView(runtime, deviceId, daily);
      });
      return json(response);
    }
    if (path === '/api/agent/state' && request.method === 'GET') {
      const state = getAgentState(runtime, deviceId);
      return json({
        user_profile: state.profile,
        agent_summary: { text: state.agent_summary, updated_at: state.agent_summary_updated_at, source: 'agent_inference' },
        preferences: state.preferences, plans: state.plans,
        conversations: state.conversations.map(conversation => ({ id: conversation.id, title: conversation.title, created_at: conversation.created_at, updated_at: conversation.updated_at, message_count: conversation.messages.length })),
        tasks: state.tasks.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(publicAgentTask),
      });
    }
    if (path === '/api/agent/profile' && request.method === 'POST') return json({ user_profile: saveProfile(runtime, deviceId, input) });
    if (path === '/api/agent/preferences' && request.method === 'POST') return json({ preferences: savePreferences(runtime, deviceId, input) });
    if (path === '/api/agent/summary' && request.method === 'POST') return json({ agent_summary: saveAgentSummary(runtime, deviceId, input) });
    if (path === '/api/agent/summary' && request.method === 'DELETE') return json({ agent_summary: clearAgentSummary(runtime, deviceId) });
    if (path === '/api/agent/tasks' && request.method === 'POST') {
      const task = createAgentTask(runtime, deviceId, input);
      return json(publicAgentTask(task), 202);
    }
    match = path.match(/^\/api\/agent\/tasks\/([0-9a-fA-F-]{36})\/confirm$/);
    if (match && request.method === 'POST') {
      return json(publicAgentTask(confirmAgentTask(runtime, deviceId, match[1].toLowerCase(), input.approve === true)));
    }
    match = path.match(/^\/api\/agent\/tasks\/([0-9a-fA-F-]{36})(?:\/step)?$/);
    if (match && request.method === 'GET') {
      const task = getAgentState(runtime, deviceId).tasks.find(item => item.id === match[1].toLowerCase());
      if (!task) fail('not_found', 404);
      return json(publicAgentTask(task));
    }
    if (match && request.method === 'POST') {
      const task = getAgentState(runtime, deviceId).tasks.find(item => item.id === match[1].toLowerCase());
      if (!task) fail('not_found', 404);
      return json(publicAgentTask(await advanceAgentTask(runtime, task)));
    }
    match = path.match(/^\/api\/agent\/plans\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'PATCH') return json({ plan: updateStudyPlan(runtime, deviceId, match[1].toLowerCase(), input) });
    match = path.match(/^\/api\/agent\/conversations\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'GET') {
      const conversation = getAgentState(runtime, deviceId).conversations.find(item => item.id === match[1].toLowerCase());
      if (!conversation) fail('not_found', 404);
      return json(conversation);
    }
    if (path === '/api/concepts/resolve' && request.method === 'POST') {
      const text = String(input.text || '').trim();
      if (!text || text.length > 1000) fail('invalid_input');
      const matches = runtime.knowledge.filter(n => n.name.includes(text) || (n.aliases || []).some(a => text.includes(a) || a.includes(text)));
      return json({ items: matches.map(n => {
        const leafIds = runtime.knowledge.filter(x => x.parent_id === n.id || x.id === n.id).map(x => x.id);
        return { term: text, node_id: n.id, level: n.level, expand_to: n.level === 3 ? 'leaf' : 'subtree', leaf_ids: leafIds, candidate_count: runtime.questions.filter(q => q.knowledge.some(k => k.code === n.code)).length };
      }) });
    }
    if (path === '/api/math/exam-years' && request.method === 'GET') {
      return json({ items: listMathExamYears(runtime, deviceId) });
    }
    if (path === '/api/math/exam-papers' && request.method === 'POST') {
      if (!Number.isInteger(input.year)) fail('invalid_input');
      const response = idempotent(runtime, request, deviceId, `math-exam:${input.year}:${input.restart === true}`, input, () => {
        const paper = createMathExamPaper(runtime, deviceId, input.year, input.restart === true);
        return paperView(paper);
      });
      return json(response, 201);
    }
    if (path === '/api/papers/compose' && request.method === 'POST') {
      if (input.source_mode !== 'real') {
        const queued = idempotent(runtime, request, deviceId, 'compose', input, () => {
          const job = createPaperJob(runtime, { ...input, device_id: deviceId }, deviceId);
          ensureJobCanStart(runtime, job);
          if (!checkQuota(runtime, deviceId, 2)) {
            discardJob(runtime, job);
            fail('quota_exceeded', 429);
          }
          return { job_id: job.id, ...jobView(job) };
        });
        return json(queued, 202);
      }
      try {
        const result = idempotent(runtime, request, deviceId, 'compose', input, () => {
        if (!checkQuota(runtime, deviceId, input.source_mode === 'real' ? 0 : 1)) fail('quota_exceeded', 429);
        const paper = composePaper({ ...input, device_id: deviceId }, runtime);
        runtime.papers.push(paper);
        runtime.composeStats.success += 1;
        return {
          paper_instance_id: paper.id, id: paper.id, mode: paper.mode, source_mode: paper.source_mode,
          items: paper.items_json, items_json: paper.items_json, total_score_x2: paper.total_score_x2,
          status: paper.status, actual_ratio: paper.actual_ratio, adjustments: paper.adjustments,
          dataset: paper.dataset,
        };
        });
        return json(result, 201);
      } catch (error) {
        runtime.composeStats.failure += 1;
        throw error;
      }
    }
    if (path === '/api/papers' && request.method === 'GET') {
      const items = runtime.papers
        .filter(paper => paper.device_id === deviceId && (paper.subject || 'math2') === 'math2')
        .slice()
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map(paper => {
          const concepts = (paper.config_json?.concept_node_ids || [])
            .map(id => runtime.knowledge.find(node => node.id === id)?.name)
            .filter(Boolean);
          const summary = paper.status === 'submitted' ? submissionSummary(paper, runtime.attempts) : null;
          const maxScore = paper.items_json.reduce((sum, item) => sum + item.score_x2, 0);
          const origin = paper.config_json?.origin || paper.origin || null;
          const sourceCount = paper.config_json?.variant_items?.length || 0;
          const years = [...new Set(paper.items_json.map(item => item.question?.year).filter(Boolean))].sort((a, b) => b - a);
          return {
            id: paper.id, mode: paper.mode, source_mode: paper.source_mode, status: paper.status,
            created_at: paper.created_at, submitted_at: paper.submitted_at, origin, years,
            questions: paper.items_json.length, total_score_x2: paper.total_score_x2,
            actual_ratio: paper.actual_ratio, concepts,
            title: origin === 'repair'
              ? readableRepairTitle(paper, runtime)
              : origin === 'variant'
                ? `错题仿真练习${sourceCount ? `（${sourceCount} 道错题）` : ''}`
                : origin === 'math_exam' ? paper.title
                : concepts.length ? `${concepts.slice(0, 3).join(' · ')}${concepts.length > 3 ? ' 等' : ''}` : '综合练习',
            score_x2: summary?.score_x2 ?? null, max_score_x2: summary?.max_score_x2 ?? maxScore,
            score_rate_bp: summary?.score_rate_bp ?? null,
          };
        });
      return json({ items });
    }
    match = path.match(/^\/api\/papers\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'GET') {
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase() && p.device_id === deviceId && (p.subject || 'math2') === 'math2');
      if (!paper) fail('not_found', 404);
      const concepts = (paper.config_json?.concept_node_ids || [])
        .map(id => runtime.knowledge.find(node => node.id === id)?.name)
        .filter(Boolean);
      const origin = paper.config_json?.origin || paper.origin || null;
      const sourceCount = paper.config_json?.variant_items?.length || 0;
      return json({
        id: paper.id, paper_instance_id: paper.id, mode: paper.mode, source_mode: paper.source_mode,
        status: paper.status, items: paper.items_json, items_json: paper.items_json, origin,
        years: [...new Set(paper.items_json.map(item => item.question?.year).filter(Boolean))].sort((a, b) => b - a),
        total_score_x2: paper.total_score_x2, actual_ratio: paper.actual_ratio,
        adjustments: paper.adjustments, dataset: paper.dataset, created_at: paper.created_at,
        submitted_at: paper.submitted_at, concepts,
        title: origin === 'repair'
          ? readableRepairTitle(paper, runtime)
          : origin === 'variant'
            ? `错题仿真练习${sourceCount ? `（${sourceCount} 道错题）` : ''}`
            : origin === 'math_exam' ? paper.title
            : concepts.length ? `${concepts.slice(0, 3).join(' · ')}${concepts.length > 3 ? ' 等' : ''}` : null,
        result: paper.status === 'submitted' ? paperResult(paper, runtime) : null,
      });
    }
    match = path.match(/^\/api\/papers\/([0-9a-fA-F-]{36})\/submit$/);
    if (match && request.method === 'POST') {
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase() && p.device_id === deviceId && (p.subject || 'math2') === 'math2');
      if (!paper) fail('not_found', 404);
      if (!Array.isArray(input.answers) || input.answers.length > 100) fail('invalid_input');
      for (const answer of input.answers) {
        if (!answer || typeof answer.question_id !== 'string' || typeof (answer.answer_raw ?? '') !== 'string') fail('invalid_input');
        if (String(answer.answer_raw || '').length > 20000) fail('payload_too_large', 413);
      }
      const result = idempotent(runtime, request, deviceId, `submit:${paper.id}`, input, () => {
        gradeSubmission(paper, { ...input, device_id: deviceId }, runtime);
        syncRepairForPaper(runtime, paper);
        return { paper_instance_id: paper.id, ...paperResult(paper, runtime) };
      });
      return json(result);
    }
    if (path === '/api/wrong-book' && request.method === 'GET') {
      return json({ items: listWrongBook(deviceId, runtime).map(item => {
        const repair = item.question ? findRepairCase(deviceId, runtime, item.question_id) : null;
        const repairView = repair ? repairCaseView(repair, runtime, deviceId) : null;
        const knowledge = (item.question?.knowledge || []).map(node => {
          const known = runtime.knowledge.find(candidate => candidate.code === node.code);
          return { code: node.code, name: known?.name || node.code };
        });
        return {
          ...item, knowledge,
          question: item.question ? (item.daily_answer ? publicDailyQuestion(item.question) : publicQuestion(item.question)) : null,
          attempt: item.attempt ? publicAttempt(item.attempt) : null,
          review: item.question ? reviewQuestion(item.question) : null,
          variant_stats: item.question ? variantMastery(item, deviceId, runtime) : null,
          repair: repairView ? {
            id: repairView.id, status: repairView.status, diagnosis: repairView.diagnosis,
            repair_passes: repairView.repair_passes, repair_variants_done: repairView.repair_variants_done,
            next_repair_at: repairView.next_repair_at, paper_id: repairView.paper_id,
            selection_count: repairView.selection_count, last_selected_at: repairView.last_selected_at,
          } : null,
        };
      }) });
    }
    match = path.match(/^\/api\/wrong-book\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'DELETE') {
      const wrong = runtime.wrongBook.find(item => item.device_id === deviceId && item.question_id === match[1].toLowerCase());
      if (!wrong) fail('not_found', 404);
      const repair = findRepairCase(deviceId, runtime, wrong.question_id);
      if (!repair || (repair.repair_passes || 0) < 5) fail('not_mastered', 409);
      runtime.wrongBook.splice(runtime.wrongBook.indexOf(wrong), 1);
      runtime.repairCases = (runtime.repairCases || []).filter(item => !(item.device_id === deviceId && item.question_id === wrong.question_id));
      return json({ deleted: true, question_id: wrong.question_id });
    }
    if (path === '/api/review/today' && request.method === 'GET') {
      const items = todayReview(deviceId, runtime).map(item => ({
        ...item,
        question: item.question ? (item.daily_answer ? publicDailyQuestion(item.question) : publicQuestion(item.question)) : null,
        attempt: item.attempt ? publicAttempt(item.attempt) : null,
        review: item.question ? reviewQuestion(item.question) : null,
      }));
      return json({ items, count: items.length });
    }
    match = path.match(/^\/api\/questions\/([0-9a-fA-F-]{36})\/similar$/);
    if (match && request.method === 'GET') {
      return json({ items: similarQuestions(match[1].toLowerCase(), deviceId, runtime).map(r => ({ question: publicQuestion(r.question), reason: r.reason })) });
    }
    match = path.match(/^\/api\/questions\/([0-9a-fA-F-]{36})\/reports$/);
    if (match && request.method === 'POST') {
      const question = runtime.questions.find(q => q.id === match[1].toLowerCase());
      if (!question) fail('not_found', 404);
      const reasons = ['wrong_answer', 'unsolvable', 'ambiguous', 'out_of_syllabus', 'duplicate'];
      if (!reasons.includes(input.reason)) fail('invalid_input');
      if (question.source !== 'ai') fail('invalid_input');
      if (!checkQuota(runtime, deviceId, 1)) fail('quota_exceeded', 429);
      const result = idempotent(runtime, request, deviceId, `report:${question.id}`, input, () => {
        const report = { id: uuid(), question_id: question.id, device_id: deviceId, reason: input.reason, detail: String(input.detail || '').slice(0, 1000) || null, status: 'open', created_at: nowIso() };
        runtime.reports.push(report); question.status = 'pending_review';
        return { report_id: report.id, question_status: question.status };
      });
      return json(result, 201);
    }
    if (path === '/api/metrics/current' && request.method === 'GET') return json(currentMetrics(runtime));
    if (path === '/api/metrics/trends' && request.method === 'GET') {
      const series = metricTrends(runtime);
      return json({ series, from: series[0]?.date || null, to: series.at(-1)?.date || null, insufficient_data: runtime.attempts.length < 3 });
    }
    match = path.match(/^\/api\/metrics\/papers\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'GET') {
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase() && (p.subject || 'math2') === 'math2');
      if (!paper) fail('not_found', 404);
      const concepts = (paper.config_json?.concept_node_ids || [])
        .map(id => runtime.knowledge.find(node => node.id === id))
        .filter(Boolean)
        .map(node => ({ id: node.id, name: node.name, level: node.level }));
      return json({
        id: paper.id, mode: paper.mode, source_mode: paper.source_mode, status: paper.status,
        created_at: paper.created_at, total_score_x2: paper.total_score_x2,
        actual_ratio: paper.actual_ratio, adjustments: paper.adjustments, concepts,
        items: paper.items_json.map(item => {
          const question = runtime.questions.find(q => q.id === item.question_id) || item.question;
          return { question: publicQuestion(question), score_x2: item.score_x2 };
        }),
        note: '公开预览仅展示题干与选项，不含答案。',
      });
    }
    if (path === '/api/repair/cases' && request.method === 'GET') {
      return json({ items: listRepairCases(deviceId, runtime).map(item => ({
        ...item,
        question: item.question ? publicQuestion(item.question) : null,
      })) });
    }
    if (path === '/api/repair/today' && request.method === 'GET') {
      return json(repairDailyPayload(deviceId, runtime));
    }
    if (path === '/api/repair/today/replace' && request.method === 'POST') {
      if (typeof input.question_id !== 'string') fail('invalid_input');
      const replaced = replaceDailyRepair(deviceId, runtime, input.question_id.toLowerCase());
      if (replaced === null) fail('not_found', 404);
      if (replaced === false) fail('repair_no_candidate', 409);
      return json(repairDailyPayload(deviceId, runtime));
    }
    match = path.match(/^\/api\/repair\/questions\/([0-9a-fA-F-]{36})\/generate$/);
    if (match && request.method === 'POST') {
      const questionId = match[1].toLowerCase();
      const repair = findRepairCase(deviceId, runtime, questionId);
      if (!repair) fail('not_found', 404);
      const result = idempotent(runtime, request, deviceId, `repair:${questionId}`, input, () => {
        const job = createVariantJob(runtime, {
          items: [{ question_id: questionId, count: 3 }],
          repair_case_id: repair.id,
        }, deviceId);
        ensureJobCanStart(runtime, job);
        if (!checkQuota(runtime, deviceId, 2)) {
          discardJob(runtime, job);
          fail('quota_exceeded', 429);
        }
        return { job_id: job.id, repair_case_id: repair.id, ...jobView(job) };
      });
      return json(result, 202);
    }
    if (path === '/api/variants' && request.method === 'POST') {
      const result = idempotent(runtime, request, deviceId, 'variant', input, () => {
        const job = createVariantJob(runtime, input, deviceId);
        ensureJobCanStart(runtime, job);
        if (!checkQuota(runtime, deviceId, 2)) {
          discardJob(runtime, job);
          fail('quota_exceeded', 429);
        }
        return { job_id: job.id, ...jobView(job) };
      });
      return json(result, 202);
    }
    match = path.match(/^\/api\/jobs\/([0-9a-fA-F-]{36})(?:\/step)?$/);
    if (match && request.method === 'POST') {
      const job = runtime.jobs.find(j => j.id === match[1].toLowerCase() && j.device_id === deviceId && (j.kind === 'paper' || j.kind === 'variant' || j.kind === 'cs408_paper'));
      if (!job) fail('not_found', 404);
      const updated = job.kind === 'variant' ? await advanceVariantJob(runtime, job)
        : job.kind === 'cs408_paper' ? await advanceCs408PaperJob(runtime, job)
        : await advancePaperJob(runtime, job);
      return json(jobView(updated));
    }
    if (match && request.method === 'GET') {
      const job = runtime.jobs.find(j => j.id === match[1].toLowerCase() && j.device_id === deviceId);
      if (!job) fail('not_found', 404);
      return json(jobView(job));
    }
    if (path === '/api/assets' && request.method === 'POST') {
      return json(createImageAsset(runtime, deviceId, input), 201);
    }
    if (path === '/api/recognition' && request.method === 'POST') {
      if (typeof input.image_asset_id !== 'string' || typeof input.question_id !== 'string') fail('invalid_input');
      const response = await asyncIdempotent(runtime, request, deviceId, 'recognition', input, () => recognizeAnswer(runtime, deviceId, input));
      return json(response);
    }
    fail('not_found', 404);
  };
}
export function errorResponse(error) {
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : 'internal_error';
  return json({ ok: false, error: { code } }, status);
}
