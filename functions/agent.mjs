import { AppError, fail, nowIso } from './model.mjs';
import { chat } from './llm.mjs';
import { providerFor } from './ai-settings.mjs';
import { executeAgentTool, agentToolLabels, agentToolSchemas } from './agent-tools.mjs';
import { buildAgentContext, updateConversationSummary } from './agent-context.mjs';
import { appendMessages, getAgentState, getConversation, saveAgentSummary } from './agent-store.mjs';
import { advancePaperJob, advanceVariantJob } from './generate.mjs';

const JOB_ERROR_TEXT = {
  ai_blind_solve_mismatch: '生成题目未通过盲解校验',
  ai_count_mismatch: '生成数量与要求不一致',
  ai_invalid_json: '模型返回格式异常',
  ai_invalid_item: '生成题目不完整',
  ai_invalid_options: '选择题选项不完整',
  llm_unreachable: '无法连接模型',
  llm_upstream_error: '模型服务返回错误',
  llm_not_configured: '尚未配置模型',
};
function jobErrorText(job) { return JOB_ERROR_TEXT[job.error] || '组卷失败'; }

async function waitForPendingJob(runtime, task) {
  const pending = task.pending_job;
  const job = runtime.jobs.find(item => item.id === pending.id && item.device_id === task.device_id);
  if (!job) {
    task.context_state.tool_results = [...(task.context_state.tool_results || []), { tool: pending.tool, ok: false, summary: '出卷任务已丢失，请重新发起。', data: { job_id: pending.id } }];
    task.pending_job = null;
    task.status = 'queued';
    task.stage = '出卷任务丢失，准备重试';
    return task;
  }
  if (!['succeeded', 'failed'].includes(job.status)) {
    const updated = job.kind === 'variant' ? await advanceVariantJob(runtime, job) : await advancePaperJob(runtime, job);
    task.stage = updated.stage || '正在生成练习卷';
    task.status = 'waiting_async';
    task.updated_at = nowIso();
    if (!['succeeded', 'failed'].includes(updated.status)) return task;
    job.status = updated.status;
    job.paper = updated.paper;
    job.error = updated.error;
  }
  const results = task.context_state.tool_results || [];
  if (job.status === 'succeeded' && job.paper) {
    results.push({ tool: pending.tool, ok: true, summary: `已生成试卷，共 ${job.paper.items_json.length} 题。`, data: { job_id: job.id, paper_id: job.paper.id } });
    task.context_state.artifacts = [...(task.context_state.artifacts || []), { type: 'paper', id: job.paper.id }];
    task.stage = '试卷已生成，整理结果';
  } else {
    results.push({ tool: pending.tool, ok: false, summary: `生成失败：${jobErrorText(job)}。请调整题量、难度或改用真题后重试。`, data: { job_id: job.id, error: job.error } });
    task.stage = '组卷失败，正在调整方案';
  }
  task.context_state.tool_results = results;
  task.context_state.tool_summaries = results.map(item => ({ tool: item.tool, ok: item.ok, summary: item.summary }));
  task.pending_job = null;
  task.status = 'queued';
  task.updated_at = nowIso();
  return task;
}

function parseDecision(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new AppError('agent_invalid_json', 502);
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw new AppError('agent_invalid_json', 502); }
}

function decisionPrompt(context) {
  return `${context.messages.map(message => `${message.role}: ${message.content}`).join('\n\n')}\n\n请输出严格 JSON，不要代码块：\n如果必须调用工具：{"action":"tool","tool":"工具名","args":{},"reply":"向用户说明正在做什么"}\n如果信息不足或需要用户确认：{"action":"ask","reply":"需要确认的问题","requires_confirmation":true}\n如果可以完成：{"action":"respond","reply":"最终回复","summary_update":"可选：根据本轮事实更新 Agent 推断"}\n工具名只能来自已注入的工具 schema，不能编造。工具结果已包含所需 ID 时直接使用，不要重复调用同一个只读工具。给用户的 reply 不要包含 UUID、哈希或内部 ID；用题号、知识点名称和试卷标题表达。`;
}

function contextToolData(name, data) {
  if (!data) return undefined;
  if (name === 'get_paper_detail') {
    return { ...data, items: (data.items || []).slice(0, 20).map(item => ({
      question: { id: item.question.id, qtype: item.question.qtype, stem_latex: item.question.stem_latex, options: item.question.options, answer: item.question.answer },
      score_x2: item.score_x2, attempt: item.attempt,
    })), truncated: (data.items || []).length > 20 };
  }
  if (['list_knowledge_nodes', 'list_wrong_questions', 'list_papers', 'get_today_review', 'diagnose_attempts', 'get_question_detail', 'get_study_plan'].includes(name)) return data;
  if (data.job_id || data.paper_id || data.id) return { id: data.id, paper_id: data.paper_id, job_id: data.job_id, status: data.status, stage: data.stage, error: data.error };
  return undefined;
}

async function decide(runtime, deviceId, context) {
  const llm = providerFor(runtime, deviceId);
  if (!llm) throw new AppError('llm_not_configured', 409);
  const messages = [{ role: 'system', content: '你是研数学习助手的决策器。只输出 JSON。' }, { role: 'user', content: decisionPrompt(context) }];
  const raw = await llm(messages, { maxTokens: context.budget.safe_output, temperature: 0.2 });
  try {
    return parseDecision(raw);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'agent_invalid_json') throw error;
    const repaired = await llm([
      { role: 'system', content: '你是 JSON 修复器。只输出合法 JSON，不要解释。' },
      { role: 'user', content: `把下面内容修复为决策 JSON。action 只能是 tool、ask、respond；如果是 tool，必须有 tool 和 args；如果是 ask/respond，必须有 reply。\n原始内容：${String(raw).slice(-12000)}` },
    ], { maxTokens: context.budget.safe_output, temperature: 0 });
    return parseDecision(repaired);
  }
}

function readableReply(runtime, text) {
  const labels = new Map();
  for (const question of runtime.questions) {
    labels.set(question.id.slice(0, 8).toLowerCase(), question.year ? `${question.year} 年第 ${question.seq_label} 题` : `AI 原创第 ${question.seq_label} 题`);
  }
  for (const paper of runtime.papers) {
    labels.set(paper.id.slice(0, 8).toLowerCase(), paper.title || '数学二练习卷');
  }
  return String(text || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, token => labels.get(token.slice(0, 8).toLowerCase()) || '相关记录')
    .replace(/\b[0-9a-f]{8}\b/gi, token => labels.get(token.toLowerCase()) || '相关记录');
}

function taskView(task) {
  return {
    id: task.id, conversation_id: task.conversation_id, goal: task.goal,
    status: task.status, stage: task.stage, current_step: task.current_step,
    steps: task.steps, result: task.result, error: task.error,
    context_state: task.context_state, created_at: task.created_at, updated_at: task.updated_at,
  };
}

export function createAgentTask(runtime, deviceId, input) {
  const goal = String(input.goal || '').trim();
  if (!goal || goal.length > 2000) fail('invalid_input');
  if (!providerFor(runtime, deviceId)) fail('llm_not_configured', 409);
  const conversation = getConversation(runtime, deviceId, input.conversation_id);
  const state = getAgentState(runtime, deviceId);
  const task = {
    id: crypto.randomUUID(), device_id: deviceId, conversation_id: conversation.id,
    goal, status: 'queued', stage: '理解需求', current_step: 0, steps: [],
    confirmed: input.confirmed === true,
    context_state: {}, result: null, error: null, created_at: nowIso(), updated_at: nowIso(),
  };
  state.tasks.push(task);
  appendMessages(conversation, [{ role: 'user', content: goal, created_at: nowIso() }]);
  return task;
}

export async function advanceAgentTask(runtime, task) {
  if (['succeeded', 'failed', 'degraded', 'waiting_user', 'cancelled'].includes(task.status)) return task;
  const state = getAgentState(runtime, task.device_id);
  const conversation = state.conversations.find(item => item.id === task.conversation_id);
  if (!conversation) throw new AppError('agent_conversation_missing', 500);
  task.updated_at = nowIso();
  try {
    if (task.pending_job) return await waitForPendingJob(runtime, task);
    const toolResults = task.context_state.tool_results || [];
    const toolContext = toolResults.map(item => ({ tool: item.tool, ok: item.ok, summary: item.summary, data: contextToolData(item.tool, item.data) }));
    const context = buildAgentContext(runtime, task.device_id, conversation, task.goal, toolContext);
    if (task.confirmed) {
      context.messages.splice(Math.max(0, context.messages.length - 1), 0, { role: 'system', content: '用户已确认上一轮方案，不要重复询问，直接调用工具或给出最终结果。' });
    }
    task.context_state.context_stats = context.stats;
    const decision = await decide(runtime, task.device_id, context);
    if (!['tool', 'ask', 'respond'].includes(decision.action)) throw new AppError('agent_invalid_action', 502);
    if (decision.action === 'ask') {
      task.status = 'waiting_user';
      task.stage = '等待确认';
      task.result = { reply: readableReply(runtime, decision.reply || '请确认后继续。'), requires_confirmation: true };
      appendMessages(conversation, [{ role: 'assistant', content: task.result.reply, created_at: nowIso(), task_id: task.id }]);
      return task;
    }
    if (decision.action === 'respond') {
      task.status = 'succeeded';
      task.stage = '完成';
      task.result = { reply: readableReply(runtime, decision.reply || '已完成。'), artifacts: task.context_state.artifacts || [] };
      appendMessages(conversation, [{ role: 'assistant', content: task.result.reply, created_at: nowIso(), task_id: task.id }]);
      if (decision.summary_update && String(decision.summary_update).trim()) {
        saveAgentSummary(runtime, task.device_id, { summary: String(decision.summary_update).trim() });
      }
      updateConversationSummary(conversation, context.budget);
      return task;
    }
    if (!agentToolSchemas.some(tool => tool.name === decision.tool)) throw new AppError('agent_unknown_tool', 400);
    if (task.current_step >= 6) {
      task.status = 'degraded';
      task.stage = '达到步数上限';
      task.result = { reply: '本轮已完成部分查询，请确认下一步后再继续。', artifacts: task.context_state.artifacts || [], partial: true };
      return task;
    }
    task.stage = `正在${agentToolLabels[decision.tool] || '处理学习任务'}`;
    task.current_step += 1;
    const step = { index: task.current_step, tool: decision.tool, arguments_summary: JSON.stringify(decision.args || {}).slice(0, 500), status: 'running', created_at: nowIso() };
    try {
      const result = await executeAgentTool(runtime, task.device_id, decision.tool, decision.args || {}, { confirmed: task.confirmed });
      step.status = 'completed';
      step.result_summary = result.summary;
      step.data = result.data;
      toolResults.push({ tool: decision.tool, ok: true, summary: result.summary, data: result.data });
      task.context_state.tool_results = toolResults;
      task.context_state.tool_summaries = toolResults.map(item => ({ tool: item.tool, ok: item.ok, summary: item.summary }));
      const artifacts = task.context_state.artifacts || [];
      if (result.data?.paper_id) artifacts.push({ type: 'paper', id: result.data.paper_id });
      if (result.data?.id && decision.tool === 'create_study_plan') artifacts.push({ type: 'plan', id: result.data.id });
      task.context_state.artifacts = artifacts;
      task.steps.push(step);
      if (result.data?.job_id) {
        task.pending_job = { id: result.data.job_id, tool: decision.tool };
        task.status = 'waiting_async';
        task.stage = '正在生成练习卷';
        return task;
      }
      task.stage = '整理工具结果';
      return task;
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof AppError ? error.code : 'tool_failed';
      task.steps.push(step);
      if (error instanceof AppError && error.code === 'confirmation_required') {
        task.status = 'waiting_user';
        task.stage = '等待确认';
        task.result = { reply: '这个操作会写入你的学习记录，请确认后继续。', requires_confirmation: true };
        return task;
      }
      if (['llm_not_configured', 'llm_unreachable', 'llm_upstream_error'].includes(error?.code)) throw error;
      toolResults.push({ tool: decision.tool, ok: false, summary: `工具失败：${error?.code || 'tool_failed'}`, data: null });
      task.context_state.tool_results = toolResults;
      task.stage = '处理工具失败';
      return task;
    }
  } catch (error) {
    task.status = 'failed';
    task.stage = '失败';
    task.error = error instanceof AppError ? error.code : 'agent_failed';
    task.result = { reply: task.error === 'llm_not_configured' ? '无法连接模型，请确认已配置模型' : '学习助手暂时无法完成，请重试。' };
    if (conversation) appendMessages(conversation, [{ role: 'assistant', content: task.result.reply, created_at: nowIso(), task_id: task.id }]);
    return task;
  }
}

export function confirmAgentTask(runtime, deviceId, taskId, approve) {
  const state = getAgentState(runtime, deviceId);
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) fail('not_found', 404);
  if (task.status !== 'waiting_user') fail('agent_task_not_waiting', 409);
  task.confirmed = approve === true;
  task.status = approve === true ? 'queued' : 'cancelled';
  task.stage = approve === true ? '已确认，准备执行' : '已取消';
  task.result = approve === true ? null : { reply: '已取消本次操作，没有执行任何写入。', requires_confirmation: false };
  task.updated_at = nowIso();
  const conversation = state.conversations.find(item => item.id === task.conversation_id);
  if (conversation) appendMessages(conversation, [{
    role: 'user', content: approve === true ? '确认执行上面的方案。' : '暂不执行上面的方案。', created_at: nowIso(),
  }]);
  return task;
}

export function publicAgentTask(task) { return taskView(task); }
