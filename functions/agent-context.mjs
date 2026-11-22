import { agentToolSchemas } from './agent-tools.mjs';
import { getAgentState } from './agent-store.mjs';
import { settingsFor } from './ai-settings.mjs';
import { defaultLlmConfig } from './llm.mjs';

export const MODEL_PROFILES = {
  'gpt-4o-mini': { contextWindow: 128000, maxOutput: 16384 },
  'deepseek-chat': { contextWindow: 65536, maxOutput: 8192 },
  'trae-cn/deepseek-v4.1-flash-max': { contextWindow: 128000, maxOutput: 8192 },
};
const DEFAULT_PROFILE = { contextWindow: 32768, maxOutput: 4096 };

export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    units += code > 0x7f ? 1 : /[\s\w.,;:!?()[\]{}]/.test(char) ? 0.35 : 0.65;
  }
  return Math.max(1, Math.ceil(units));
}

export function resolveModelProfile(model) {
  const known = MODEL_PROFILES[model];
  if (known) return { ...known, known: true, model };
  return { ...DEFAULT_PROFILE, known: false, model: model || '' };
}

export function contextBudget(runtime, deviceId) {
  const model = settingsFor(runtime, deviceId)?.model || defaultLlmConfig()?.model;
  const profile = resolveModelProfile(model);
  const safeOutput = Math.min(profile.maxOutput, Math.floor(profile.contextWindow * 0.25));
  const inputBudget = profile.contextWindow - safeOutput;
  const fixed = estimateTokens(agentToolSchemas) + 3500;
  const availableForHistory = Math.max(0, inputBudget - fixed);
  return {
    ...profile,
    safe_output: safeOutput,
    input_budget: inputBudget,
    fixed_budget: fixed,
    history_budget: Math.floor(availableForHistory * 0.6),
    summary_budget: Math.floor(availableForHistory * 0.2),
    current_budget: Math.floor(availableForHistory * 0.2),
    budget_source: profile.known ? 'model_profile' : 'conservative_default',
  };
}

function summaryOf(messages) {
  const old = messages.map(message => `${message.role}: ${String(message.content || '').slice(0, 500)}`).join('\n');
  return old ? `历史对话摘要（已压缩，保留任务状态）：\n${old.slice(-2500)}` : '';
}

export function buildAgentContext(runtime, deviceId, conversation, currentInput, toolResults = []) {
  const state = getAgentState(runtime, deviceId);
  const budget = contextBudget(runtime, deviceId);
  const profileText = JSON.stringify(state.profile);
  const preferencesText = JSON.stringify(state.preferences);
  const summaryText = state.agent_summary || '（暂无 Agent 推断）';
  const plans = state.plans.filter(plan => plan.status === 'active').map(plan => ({ id: plan.id, title: plan.title, items: plan.items }));
  const system = `你是研数的学习助手 Agent。你的任务是理解考研数学二用户的情况，调用白名单工具，给出可执行的学习结果。
规则：
1. 用户填写的档案是事实，不得擅自修改；Agent Summary 是推断，可能过时，必要时用工具验证。
2. 用户偏好是偏好，不是事实。
3. 不要声称已生成试卷，除非工具返回真实 paper_id 或 job_id。
4. 待复核解答题不参与掌握度计算，不能把未评分当错误。
5. 不要执行任意 SQL、代码或未注册工具。
6. 回复简洁、具体，优先给出下一步行动。
7. 回复用户时不要出现 UUID、哈希、内部 question_id、paper_id、job_id 或 knowledge_code；请用“2011 年第 2 题”“试卷标题”“知识点名称”等可读标签。工具参数中可以使用内部 ID。
8. 如果出卷或变式任务失败，先根据失败原因调整方案（减少题量、降低难度或改用真题）再重试；不要重复完全相同的失败配置。无法完成时明确说明原因。`;
  const fixed = [
    system,
    `用户明确填写的档案（事实）：${profileText}`,
    `Agent 自己总结的档案（推断，可能过时）：${summaryText}`,
    `用户偏好（偏好，不是事实）：${preferencesText}`,
    `当前计划状态：${JSON.stringify(plans)}`,
    `工具 Schema（全量注入）：${JSON.stringify(agentToolSchemas)}`,
  ].join('\n\n');
  const history = [];
  const raw = conversation.messages || [];
  let historyTokens = 0;
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const message = raw[index];
    const tokens = estimateTokens(message.content);
    if (historyTokens + tokens > budget.history_budget) break;
    history.unshift({ role: message.role, content: message.content });
    historyTokens += tokens;
  }
  const omitted = raw.slice(0, Math.max(0, raw.length - history.length));
  const summary = conversation.summary || summaryOf(omitted);
  const toolText = toolResults.map(result => ({
    tool: result.tool, ok: result.ok, summary: result.summary,
    data: result.data,
  }));
  const messages = [{ role: 'system', content: fixed }];
  if (summary) messages.push({ role: 'system', content: summary });
  messages.push(...history);
  if (toolText.length) messages.push({ role: 'system', content: `本轮工具结果：${JSON.stringify(toolText)}` });
  const now = new Date();
  const timeText = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long', hour12: false,
  }).format(now);
  messages.push({ role: 'user', content: `${currentInput}\n\n当前时间：${timeText}（Asia/Shanghai）` });
  const stats = {
    ...budget,
    input_tokens: estimateTokens(messages),
    output_budget: budget.safe_output,
    retained_messages: history.length,
    compressed_messages: omitted.length,
    compressed: omitted.length > 0,
    compression_strategy: omitted.length ? 'oldest_structured_summary' : 'none',
  };
  return { messages, stats, budget, state };
}

export function updateConversationSummary(conversation, budget) {
  const raw = conversation.messages || [];
  let tokens = 0;
  let firstKept = raw.length;
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    tokens += estimateTokens(raw[index].content);
    if (tokens > budget.history_budget) break;
    firstKept = index;
  }
  if (firstKept < raw.length) {
    const old = raw.slice(0, firstKept);
    conversation.summary = summaryOf(old);
    conversation.compressed_at = new Date().toISOString();
  }
}
