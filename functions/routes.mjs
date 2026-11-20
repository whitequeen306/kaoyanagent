import { AppError, fail, assertDeviceId, uuid, nowIso } from './model.mjs';
import { composePaper } from './compose.mjs';
import { gradeSubmission, submissionSummary, publicQuestion, reviewQuestion } from './grade.mjs';
import { listWrongBook, todayReview, similarQuestions, variantMastery } from './review.mjs';
import { currentMetrics, metricTrends } from './metrics.mjs';
import { checkQuota } from './runtime.mjs';
import { advancePaperJob, advanceVariantJob, createPaperJob, createVariantJob } from './generate.mjs';
import { publicAiSettings, providerFor, saveAiSettings, settingsFor } from './ai-settings.mjs';
import { getAgentState, saveProfile, savePreferences, saveAgentSummary, clearAgentSummary, updateStudyPlan } from './agent-store.mjs';
import { advanceAgentTask, confirmAgentTask, createAgentTask, publicAgentTask } from './agent.mjs';

function json(value, status = 200) { return Response.json(value, { status }); }
function paperView(paper) { const { device_id, ...rest } = paper; return rest; }
function jobView(job) {
  return {
    id: job.id, status: job.status, stage: job.stage, progress: job.progress,
    phase: job.phase || null, detail: job.detail || '',
    expected_count: job.expected_count || 0,
    generated_count: job.generated_count || 0,
    verified_count: job.verified_count || 0,
    reused_count: job.reused_count || 0,
    error: job.error || null,
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
    answer_raw: attempt.answer_raw,
  };
}
function paperResult(paper, runtime) {
  const attempts = runtime.attempts.filter(attempt => attempt.paper_instance_id === paper.id);
  return {
    attempts: attempts.map(attempt => {
      const question = runtime.questions.find(q => q.id === attempt.question_id);
      return { ...publicAttempt(attempt), ...(question ? reviewQuestion(question) : {}) };
    }),
    ...submissionSummary(paper, attempts), diagnosis: null,
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
    if (path === '/api/ai-settings' && request.method === 'GET') {
      return json(publicAiSettings(settingsFor(runtime, deviceId)));
    }
    if (path === '/api/ai-settings' && request.method === 'POST') {
      return json(await saveAiSettings(runtime, deviceId, input, settingsFor(runtime, deviceId)));
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
    if (path === '/api/papers/compose' && request.method === 'POST') {
      if (input.source_mode !== 'real') {
        if (!providerFor(runtime, deviceId)) fail('llm_not_configured', 409);
        const queued = idempotent(runtime, request, deviceId, 'compose', input, () => {
          if (!checkQuota(runtime, deviceId, 2)) fail('quota_exceeded', 429);
          const job = createPaperJob(runtime, { ...input, device_id: deviceId }, deviceId);
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
        .filter(paper => paper.device_id === deviceId)
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
          return {
            id: paper.id, mode: paper.mode, source_mode: paper.source_mode, status: paper.status,
            created_at: paper.created_at, submitted_at: paper.submitted_at, origin,
            questions: paper.items_json.length, total_score_x2: paper.total_score_x2,
            actual_ratio: paper.actual_ratio, concepts,
            title: origin === 'variant'
              ? `错题仿真练习${sourceCount ? `（${sourceCount} 道错题）` : ''}`
              : concepts.length ? `${concepts.slice(0, 3).join(' · ')}${concepts.length > 3 ? ' 等' : ''}` : '综合练习',
            score_x2: summary?.score_x2 ?? null, max_score_x2: summary?.max_score_x2 ?? maxScore,
            score_rate_bp: summary?.score_rate_bp ?? null,
          };
        });
      return json({ items });
    }
    match = path.match(/^\/api\/papers\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'GET') {
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase() && p.device_id === deviceId);
      if (!paper) fail('not_found', 404);
      const concepts = (paper.config_json?.concept_node_ids || [])
        .map(id => runtime.knowledge.find(node => node.id === id)?.name)
        .filter(Boolean);
      const origin = paper.config_json?.origin || paper.origin || null;
      const sourceCount = paper.config_json?.variant_items?.length || 0;
      return json({
        id: paper.id, paper_instance_id: paper.id, mode: paper.mode, source_mode: paper.source_mode,
        status: paper.status, items: paper.items_json, items_json: paper.items_json, origin,
        total_score_x2: paper.total_score_x2, actual_ratio: paper.actual_ratio,
        adjustments: paper.adjustments, dataset: paper.dataset, created_at: paper.created_at,
        submitted_at: paper.submitted_at, concepts,
        title: origin === 'variant'
          ? `错题仿真练习${sourceCount ? `（${sourceCount} 道错题）` : ''}`
          : concepts.length ? `${concepts.slice(0, 3).join(' · ')}${concepts.length > 3 ? ' 等' : ''}` : null,
        result: paper.status === 'submitted' ? paperResult(paper, runtime) : null,
      });
    }
    match = path.match(/^\/api\/papers\/([0-9a-fA-F-]{36})\/submit$/);
    if (match && request.method === 'POST') {
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase() && p.device_id === deviceId);
      if (!paper) fail('not_found', 404);
      if (!Array.isArray(input.answers) || input.answers.length > 100) fail('invalid_input');
      for (const answer of input.answers) {
        if (!answer || typeof answer.question_id !== 'string' || typeof (answer.answer_raw ?? '') !== 'string') fail('invalid_input');
        if (String(answer.answer_raw || '').length > 20000) fail('payload_too_large', 413);
      }
      const result = idempotent(runtime, request, deviceId, `submit:${paper.id}`, input, () => {
        gradeSubmission(paper, { ...input, device_id: deviceId }, runtime);
        return { paper_instance_id: paper.id, ...paperResult(paper, runtime) };
      });
      return json(result);
    }
    if (path === '/api/wrong-book' && request.method === 'GET') {
      return json({ items: listWrongBook(deviceId, runtime).map(item => ({
        ...item,
        question: item.question ? publicQuestion(item.question) : null,
        attempt: item.attempt ? publicAttempt(item.attempt) : null,
        review: item.question ? reviewQuestion(item.question) : null,
        variant_stats: item.question ? variantMastery(item, deviceId, runtime) : null,
      })) });
    }
    match = path.match(/^\/api\/wrong-book\/([0-9a-fA-F-]{36})$/);
    if (match && request.method === 'DELETE') {
      const wrong = runtime.wrongBook.find(item => item.device_id === deviceId && item.question_id === match[1].toLowerCase());
      if (!wrong) fail('not_found', 404);
      const stats = variantMastery(wrong, deviceId, runtime);
      if (!stats.mastered) fail('not_mastered', 409);
      runtime.wrongBook.splice(runtime.wrongBook.indexOf(wrong), 1);
      return json({ deleted: true, question_id: wrong.question_id });
    }
    if (path === '/api/review/today' && request.method === 'GET') {
      const items = todayReview(deviceId, runtime).map(item => ({
        ...item,
        question: item.question ? publicQuestion(item.question) : null,
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
      const paper = runtime.papers.find(p => p.id === match[1].toLowerCase());
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
    if (path === '/api/variants' && request.method === 'POST') {
      if (!providerFor(runtime, deviceId)) fail('llm_not_configured', 409);
      const result = idempotent(runtime, request, deviceId, 'variant', input, () => {
        const job = createVariantJob(runtime, input, deviceId);
        if (!checkQuota(runtime, deviceId, 2)) {
          const index = runtime.jobs.findIndex(item => item.id === job.id);
          if (index >= 0) runtime.jobs.splice(index, 1);
          fail('quota_exceeded', 429);
        }
        return { job_id: job.id, ...jobView(job) };
      });
      return json(result, 202);
    }
    match = path.match(/^\/api\/jobs\/([0-9a-fA-F-]{36})(?:\/step)?$/);
    if (match && request.method === 'POST') {
      const job = runtime.jobs.find(j => j.id === match[1].toLowerCase() && j.device_id === deviceId && (j.kind === 'paper' || j.kind === 'variant'));
      if (!job) fail('not_found', 404);
      const updated = job.kind === 'variant' ? await advanceVariantJob(runtime, job) : await advancePaperJob(runtime, job);
      return json(jobView(updated));
    }
    if (match && request.method === 'GET') {
      const job = runtime.jobs.find(j => j.id === match[1].toLowerCase() && j.device_id === deviceId);
      if (!job) fail('not_found', 404);
      return json(jobView(job));
    }
    if (path === '/api/recognition' && request.method === 'POST') fail('model_unavailable', 503);
    fail('not_found', 404);
  };
}
export function errorResponse(error) {
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : 'internal_error';
  return json({ ok: false, error: { code } }, status);
}
