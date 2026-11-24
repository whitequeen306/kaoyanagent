import { fail, QTYPES, SOURCE_MODES, MODES, DIFFICULTIES, MAX_QUESTIONS } from './model.mjs';
import { createPaperJob, createVariantJob } from './generate.mjs';
import { getAgentState, saveAgentSummary, savePreferences, createStudyPlan } from './agent-store.mjs';
import { variantMastery } from './review.mjs';

export const agentToolLabels = {
  get_user_context: '读取学习档案',
  update_preferences: '更新学习偏好',
  update_agent_summary: '更新学习总结',
  list_wrong_questions: '查看错题本',
  get_question_detail: '阅读题目与解析',
  list_papers: '翻看历史试卷',
  get_paper_detail: '查看试卷作答情况',
  get_today_review: '检查今日复习',
  list_knowledge_nodes: '查找知识点',
  diagnose_attempts: '分析近期得分情况',
  compose_paper: '生成练习卷',
  create_wrong_variants: '生成错题变式题',
  create_study_plan: '保存学习计划',
  get_study_plan: '读取学习计划',
};

const id = { type: 'string', description: 'UUID' };
const ids = { type: 'array', items: id, minItems: 1, maxItems: 30 };
const count = { type: 'integer', minimum: 1, maximum: 30 };
const typeCounts = { type: 'object', properties: { single_choice: count, fill_blank: count, free_response: count }, additionalProperties: false };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const agentToolSchemas = [
  { name: 'get_user_context', description: '读取当前用户的档案、Agent 推断、偏好和计划。只读；不要用它修改用户事实。', parameters: schema({}) },
  { name: 'update_preferences', description: '保存用户明确表达的学习偏好，不能修改用户档案或掌握度。', parameters: schema({ source_mode: { type: 'string', enum: [...SOURCE_MODES] }, question_count: count, difficulty: { type: 'string', enum: [...DIFFICULTIES] }, detail_level: { type: 'string', enum: ['concise', 'detailed'] }, hint_first: { type: 'boolean' } }) },
  { name: 'update_agent_summary', description: '把从历史对话和工具结果得到的推断写入 Agent Summary；必须有 evidence 摘要，不能覆盖用户填写的档案。', parameters: schema({ summary: { type: 'string', maxLength: 4000 }, evidence: { type: 'string', maxLength: 1000 } }, ['summary', 'evidence']) },
  { name: 'list_wrong_questions', description: '查询当前用户错题及仿真掌握率。返回摘要，不返回完整解析；需要题干时用 get_question_detail。', parameters: schema({ limit: { type: 'integer', minimum: 1, maximum: 20 }, mastered: { type: 'boolean' } }) },
  { name: 'get_question_detail', description: '读取指定错题的完整题干、选项、正确答案和解析。只读；question_id 必须来自当前用户错题或试卷。', parameters: schema({ question_id: id }, ['question_id']) },
  { name: 'list_papers', description: '查询当前用户历史试卷、状态、得分和知识点。只读。', parameters: schema({ status: { type: 'string', enum: ['draft', 'submitted'] }, limit: { type: 'integer', minimum: 1, maximum: 20 } }) },
  { name: 'get_paper_detail', description: '读取当前用户指定试卷的题目、作答、得分和解析。只读；paper_id 必须属于当前用户。', parameters: schema({ paper_id: id }, ['paper_id']) },
  { name: 'get_today_review', description: '查询当前用户今天到期需要复习的错题。只读。', parameters: schema({}) },
  { name: 'list_knowledge_nodes', description: '查询数学二知识树节点，用于组卷时获取 concept_node_ids。可按名称搜索；只读，不要编造节点 ID。', parameters: schema({ query: { type: 'string', maxLength: 100 }, level: { type: 'integer', minimum: 1, maximum: 3 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }) },
  { name: 'diagnose_attempts', description: '按知识点聚合当前用户已判分作答，给出样本量与得分率。待复核解答题不计入掌握度，不把未评分当错误。', parameters: schema({ range_days: { type: 'integer', minimum: 1, maximum: 365 } }) },
  { name: 'compose_paper', description: '创建组卷任务。用户要求出练习卷时调用；concept_node_ids 必须从知识树读取。返回 job_id，不声称试卷已完成。', parameters: schema({ concept_node_ids: ids, type_counts: typeCounts, count, source_mode: { type: 'string', enum: [...SOURCE_MODES] }, mode: { type: 'string', enum: [...MODES] }, difficulty: { type: 'string', enum: [...DIFFICULTIES] } }, ['concept_node_ids', 'type_counts', 'count', 'source_mode', 'mode', 'difficulty']) },
  { name: 'create_wrong_variants', description: '为当前用户指定错题生成同考点仿真题。每道错题至少 3 道，最多 10 道，总数不超过 30。返回 job_id。', parameters: schema({ items: { type: 'array', minItems: 1, maxItems: 10, items: schema({ question_id: id, count: { type: 'integer', minimum: 3, maximum: 10 } }, ['question_id', 'count']) } }, ['items']) },
  { name: 'create_study_plan', description: '保存用户已经确认的学习计划。不能把未经用户确认的建议直接写成长期计划。', parameters: schema({ title: { type: 'string', maxLength: 200 }, goal: { type: 'string', maxLength: 2000 }, items: { type: 'array', minItems: 1, items: schema({ title: { type: 'string', maxLength: 300 }, action: { type: 'string', maxLength: 1000 }, minutes: { type: 'integer', minimum: 5, maximum: 1440 }, paper_id: id }, ['title']) }, confirmed: { type: 'boolean' } }, ['title', 'items', 'confirmed']) },
  { name: 'get_study_plan', description: '查询当前用户已保存的学习计划。只读。', parameters: schema({ plan_id: id }) },
];

function ownQuestion(runtime, deviceId, questionId) {
  const wrong = runtime.wrongBook.find(item => item.device_id === deviceId && item.question_id === questionId);
  const inPaper = runtime.papers.some(paper => paper.device_id === deviceId && paper.items_json.some(item => item.question_id === questionId));
  const question = runtime.questions.find(item => item.id === questionId);
  if ((!wrong && !inPaper) || !question || (question.subject || 'math2') !== 'math2') fail('not_found', 404);
  return question;
}
function ownPaper(runtime, deviceId, paperId) {
  const paper = runtime.papers.find(item => item.id === paperId && item.device_id === deviceId && (item.subject || 'math2') === 'math2');
  if (!paper) fail('not_found', 404);
  return paper;
}
function wrongRows(runtime, deviceId) {
  return runtime.wrongBook.filter(item => item.device_id === deviceId).map(wrong => ({
    wrong, question: runtime.questions.find(q => q.id === wrong.question_id),
    stats: variantMastery(wrong, deviceId, runtime),
  })).filter(row => row.question && (row.question.subject || 'math2') === 'math2');
}
function questionLabel(question) {
  if (question.source === 'ai' || !question.year) return `AI 原创 · ${question.seq_label || '练习'}`;
  return `${question.year} 年第 ${question.seq_label} 题`;
}
function questionDetail(question) {
  return {
    id: question.id, label: questionLabel(question), qtype: question.qtype, year: question.year || null,
    seq_label: question.seq_label, stem_latex: question.stem_latex,
    options: question.options_json || [], sub_items: question.sub_items_json || [],
    answer: question.answer_latex,
    explanation: question.generator_meta_json?.approach_raw || '',
    steps: question.generator_meta_json?.solution_steps || [],
    knowledge: question.knowledge || [], difficulty: question.difficulty,
  };
}
function paperDetail(runtime, paper) {
  const attempts = runtime.attempts.filter(attempt => attempt.paper_instance_id === paper.id);
  return {
    id: paper.id, label: paper.title || '数学二练习卷', title: paper.title || null,
    status: paper.status, created_at: paper.created_at,
    items: paper.items_json.map(item => ({
      question: questionDetail(runtime.questions.find(q => q.id === item.question_id) || item.question),
      score_x2: item.score_x2,
      attempt: attempts.find(a => a.question_id === item.question_id) || null,
    })),
  };
}
function diagnose(runtime, deviceId, rangeDays) {
  const since = Date.now() - rangeDays * 86400000;
  const attempts = runtime.attempts.filter(attempt => attempt.device_id === deviceId
    && attempt.grading_status === 'completed' && Date.parse(attempt.created_at) >= since);
  const byCode = new Map();
  for (const attempt of attempts) {
    const question = runtime.questions.find(q => q.id === attempt.question_id);
    if (!question || (question.subject || 'math2') !== 'math2') continue;
    const code = question?.knowledge?.[0]?.code;
    if (!code) continue;
    const node = runtime.knowledge.find(item => item.code === code);
    const row = byCode.get(code) || { code, name: node?.name || code, attempts: 0, correct: 0, score_x2: 0, max_score_x2: 0 };
    row.attempts += 1;
    row.correct += attempt.score_x2 === attempt.max_score_x2 ? 1 : 0;
    row.score_x2 += attempt.score_x2;
    row.max_score_x2 += attempt.max_score_x2;
    byCode.set(code, row);
  }
  return {
    range_days: rangeDays, sample_size: attempts.length,
    pending_free_response: runtime.attempts.filter(attempt => attempt.device_id === deviceId && attempt.grading_status === 'pending_review' && Date.parse(attempt.created_at) >= since).length,
    weak_nodes: [...byCode.values()].sort((a, b) => a.score_x2 / a.max_score_x2 - b.score_x2 / b.max_score_x2)
      .map(row => ({ ...row, score_rate_bp: row.max_score_x2 ? Math.round(row.score_x2 * 10000 / row.max_score_x2) : null })),
  };
}
function validateArgs(schemaDef, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('invalid_input');
  for (const required of schemaDef.required || []) if (args[required] === undefined) fail('invalid_input');
}
export async function executeAgentTool(runtime, deviceId, name, args = {}, context = {}) {
  const definition = agentToolSchemas.find(tool => tool.name === name);
  if (!definition) fail('agent_unknown_tool', 400);
  validateArgs(definition.parameters, args);
  let data;
  switch (name) {
    case 'get_user_context': {
      const state = getAgentState(runtime, deviceId);
      data = { user_profile: state.profile, agent_summary: { text: state.agent_summary, updated_at: state.agent_summary_updated_at }, preferences: state.preferences, plans: state.plans };
      break;
    }
    case 'update_preferences': data = savePreferences(runtime, deviceId, args); break;
    case 'update_agent_summary':
      if (!String(args.evidence || '').trim()) fail('invalid_input');
      data = { summary: saveAgentSummary(runtime, deviceId, args), evidence: String(args.evidence).trim(), source: 'agent_inference' };
      break;
    case 'list_wrong_questions': {
      const limit = args.limit || 10;
      data = wrongRows(runtime, deviceId).filter(row => args.mastered === undefined || row.stats.mastered === args.mastered).slice(0, limit).map(row => ({
        question_id: row.question.id, label: questionLabel(row.question), year: row.question.year, seq_label: row.question.seq_label,
        qtype: row.question.qtype, difficulty: row.question.difficulty, knowledge: row.question.knowledge,
        mastery: row.stats, next_review_at: row.wrong.next_review_at,
      }));
      break;
    }
    case 'get_question_detail': data = questionDetail(ownQuestion(runtime, deviceId, args.question_id)); break;
    case 'list_papers': {
      const limit = args.limit || 10;
      data = runtime.papers.filter(paper => paper.device_id === deviceId && (paper.subject || 'math2') === 'math2' && (!args.status || paper.status === args.status))
        .slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit)
        .map(paper => ({ id: paper.id, title: paper.title || null, status: paper.status, created_at: paper.created_at, questions: paper.items_json.length, total_score_x2: paper.total_score_x2, source_mode: paper.source_mode, mode: paper.mode }));
      break;
    }
    case 'get_paper_detail': data = paperDetail(runtime, ownPaper(runtime, deviceId, args.paper_id)); break;
    case 'get_today_review': {
      const now = new Date().toISOString();
      data = wrongRows(runtime, deviceId).filter(row => row.wrong.next_review_at <= now).map(row => ({ question_id: row.question.id, label: questionLabel(row.question), mastery: row.stats, next_review_at: row.wrong.next_review_at }));
      break;
    }
    case 'list_knowledge_nodes': {
      const query = String(args.query || '').trim();
      data = runtime.knowledge.filter(node => (!args.level || node.level === args.level)
        && (!query || node.name.includes(query) || (node.aliases || []).some(alias => alias.includes(query))))
        .slice(0, args.limit || 30)
        .map(node => ({ id: node.id, parent_id: node.parent_id, code: node.code, name: node.name, level: node.level }));
      break;
    }
    case 'diagnose_attempts': data = diagnose(runtime, deviceId, args.range_days || 30); break;
    case 'compose_paper': {
      const total = Object.values(args.type_counts).reduce((sum, n) => sum + n, 0);
      if (args.count !== total || total < 1 || total > MAX_QUESTIONS) fail('invalid_input');
      if (args.concept_node_ids.some(nodeId => !runtime.knowledge.some(node => node.id === nodeId))) fail('invalid_input');
      const request = { ...args, device_id: deviceId };
      if (args.source_mode === 'real') {
        const { composePaper } = await import('./compose.mjs');
        const paper = composePaper(request, runtime);
        runtime.papers.push(paper);
        runtime.composeStats.success += 1;
        data = { paper_id: paper.id, status: 'ready', questions: paper.items_json.length, total_score_x2: paper.total_score_x2 };
      } else {
        const job = createPaperJob(runtime, request, deviceId);
        data = { job_id: job.id, status: job.status, stage: job.stage, expected_count: job.expected_count };
      }
      break;
    }
    case 'create_wrong_variants': data = (() => { const job = createVariantJob(runtime, args, deviceId); return { job_id: job.id, status: job.status, stage: job.stage, expected_count: job.expected_count }; })(); break;
    case 'create_study_plan':
      if (args.confirmed !== true && context.confirmed !== true) fail('confirmation_required', 409);
      data = createStudyPlan(runtime, deviceId, args);
      break;
    case 'get_study_plan': {
      const state = getAgentState(runtime, deviceId);
      data = args.plan_id ? state.plans.find(plan => plan.id === args.plan_id) || null : state.plans;
      break;
    }
    default: fail('agent_unknown_tool', 400);
  }
  return { ok: true, data, summary: summarizeToolData(name, data), error: null };
}
function summarizeToolData(name, data) {
  if (name === 'get_user_context') return `已读取你的档案、偏好和 ${data.plans.length} 个学习计划。`;
  if (name === 'list_wrong_questions') return `找到 ${data.length} 道错题。`;
  if (name === 'list_papers') return `找到 ${data.length} 张历史试卷。`;
  if (name === 'get_today_review') return data.length ? `今天有 ${data.length} 道到期复习。` : '今天没有到期复习。';
  if (name === 'list_knowledge_nodes') return `找到 ${data.length} 个相关知识点。`;
  if (name === 'get_question_detail') return `已读取「${data.label}」的题干和解析。`;
  if (name === 'get_paper_detail') return `已读取「${data.label}」的 ${data.items.length} 道题和作答。`;
  if (name === 'diagnose_attempts') return `已分析 ${data.sample_size} 道已判分作答，待复核解答题 ${data.pending_free_response} 道。`;
  if (name === 'compose_paper') return data.paper_id ? `已生成试卷，共 ${data.questions} 题。` : '已创建组卷任务，正在生成与校验。';
  if (name === 'create_wrong_variants') return `已创建错题仿真任务，共 ${data.expected_count} 题。`;
  if (name === 'create_study_plan') return `已保存学习计划「${data.title}」。`;
  if (name === 'get_study_plan') return `已读取 ${Array.isArray(data) ? data.length : 1} 个学习计划。`;
  if (name === 'update_preferences') return '已更新学习偏好。';
  if (name === 'update_agent_summary') return '已更新 Agent 推断。';
  return '这一步已完成。';
}
