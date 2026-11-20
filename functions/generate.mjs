// AI paper jobs: generate → blind solve → assemble, one bounded step per request.
import { AppError, fail, uuid, nowIso, normalizeText, QTYPES, DIFFICULTIES, MAX_QUESTIONS } from './model.mjs';
import { publicQuestion } from './grade.mjs';
import { composePaper } from './compose.mjs';
import { providerFor } from './ai-settings.mjs';
import {
  commitReusableAiQuestions,
  planReusableAiQuestions,
  releaseReusableAiQuestions,
} from './ai-question-pool.mjs';

const GENERATE_SYSTEM = `你是考研数学二的命题老师。根据给定的知识点码、题型数量、难度出题。
硬性要求：
1. 每题必须严格对应给定知识点之一，不得超纲，不得出偏题。
2. 选择题必须有 A/B/C/D 四个选项且恰有一个正确；填空题答案必须短且可比对。
3. 数学内容用 $...$；矩阵用 pmatrix，分式用 \\frac，根号用 \\sqrt。
4. 每题必须给 explanation（1-3 句解析）；解答题另给 2-5 个可核验步骤，答案写成结论。
5. 只输出 JSON，不要代码块：
{"items":[{"qtype":"single_choice","stem_latex":"...","options":[{"label":"A","latex":"..."}],"answer_latex":"B","knowledge_code":"...","exam_point":"...","difficulty":"medium","explanation":"...","solution_steps":["..."]}]}`;

const SOLVE_SYSTEM = `你是独立解题者。只根据题干解题，不得假设或猜测标准答案。
输出严格 JSON：{"answers":[{"index":1,"answer_latex":"..."}]}。选择题输出选项字母，填空题输出简短答案，解答题输出最终结论。
不要输出代码块。`;

const VARIANT_SYSTEM = `你是考研数学二的命题老师。你要根据用户的错题生成“同考点变式题”。
硬性要求：
1. 每道变式题必须用 source_question_id 标明来自哪道错题，数量必须与要求一致。
2. 保持原错题的题型、难度和知识点，不得超纲；可以改变数值、函数、条件或问法，但不能照抄原题。
3. 选择题必须有 A/B/C/D 四个选项且恰有一个正确；填空题答案必须短且可比对。
4. 数学内容用 $...$；每题给 explanation（1-3 句解析）；解答题另给 2-5 个可核验步骤。
5. 只输出 JSON，不要代码块：
{"items":[{"source_question_id":"...","qtype":"single_choice","stem_latex":"...","options":[{"label":"A","latex":"..."}],"answer_latex":"B","knowledge_code":"...","exam_point":"...","difficulty":"medium","explanation":"...","solution_steps":["..."]}]}`;

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new AppError('ai_invalid_json', 502);
  return JSON.parse(cleaned.slice(start, end + 1));
}

function targetCounts(config) {
  if (config.type_counts) {
    const entries = Object.entries(config.type_counts).filter(([type, n]) => QTYPES.has(type) && Number.isInteger(n) && n > 0);
    return Object.fromEntries(entries);
  }
  const qtypes = (config.qtypes || []).filter(type => QTYPES.has(type));
  const total = Number.isInteger(config.count) && config.count > 0 ? config.count : 0;
  if (!qtypes.length || !total) return {};
  const base = Math.floor(total / qtypes.length);
  const remainder = total % qtypes.length;
  return Object.fromEntries(qtypes.map((type, index) => [type, base + (index < remainder ? 1 : 0)]));
}

function splitMixedCounts(requested, aiTotal) {
  const entries = Object.entries(requested);
  const total = Object.values(requested).reduce((sum, n) => sum + n, 0);
  if (!aiTotal || !total) return {};
  const quotas = entries.map(([type, n], index) => {
    const exact = n * aiTotal / total;
    return { type, n, index, base: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  const allocated = Object.fromEntries(entries.map(([type]) => [type, 0]));
  for (const quota of quotas) allocated[quota.type] = quota.base;
  let remaining = aiTotal - Object.values(allocated).reduce((sum, n) => sum + n, 0);
  const order = [...quotas].sort((a, b) => b.fraction - a.fraction || b.n - a.n || a.index - b.index);
  for (let index = 0; index < remaining; index += 1) allocated[order[index].type] += 1;
  return Object.fromEntries(Object.entries(allocated).filter(([, n]) => n > 0));
}

const TYPE_NAMES = { single_choice: '选择', fill_blank: '填空', free_response: '解答' };
function describeCounts(counts) {
  return Object.entries(counts).map(([type, count]) => `${TYPE_NAMES[type] || type} ${count}`).join(' · ');
}

function scoreFor(qtype) {
  return qtype === 'free_response' ? 20 : 10;
}

function countSlotsByType(slots) {
  return slots.reduce((counts, slot) => {
    counts[slot.qtype] = (counts[slot.qtype] || 0) + 1;
    return counts;
  }, {});
}

function paperReuseSlots(job, runtime) {
  const leaves = subtreeLeaves(job.config.concept_node_ids, runtime.knowledge);
  const allowedCodes = leaves.map(node => node.code);
  return Object.entries(job.config.type_counts).flatMap(([qtype, count]) => Array.from({ length: count }, () => ({
    qtype, difficulty: job.config.difficulty, allowedCodes,
  })));
}

function variantReuseSlots(job) {
  return job.config.sources.flatMap(source => Array.from({ length: source.count }, () => ({
    qtype: source.qtype, difficulty: source.difficulty,
    allowedCodes: source.knowledge.map(node => node.code), variantOf: source.question_id,
  })));
}

function planPaperReuse(runtime, job) {
  if (job.config.reuse_planned) return;
  const plan = planReusableAiQuestions(runtime, job.id, paperReuseSlots(job, runtime));
  job.config.reuse_planned = true;
  job.config.reuse_question_ids = plan.reused.map(item => item.question.id);
  job.config.reuse_count = plan.reused.length;
  job.config.generation_type_counts = countSlotsByType(plan.toGenerate);
  job.config.generation_count = plan.toGenerate.length;
  job.reused_count = plan.reused.length;
}

function planVariantReuse(runtime, job) {
  if (job.config.reuse_planned) return;
  const plan = planReusableAiQuestions(runtime, job.id, variantReuseSlots(job));
  const generationCounts = new Map();
  for (const slot of plan.toGenerate) generationCounts.set(slot.variantOf, (generationCounts.get(slot.variantOf) || 0) + 1);
  job.config.reuse_planned = true;
  job.config.reuse_question_ids = plan.reused.map(item => item.question.id);
  job.config.reuse_count = plan.reused.length;
  job.config.generation_sources = job.config.sources
    .map(source => ({ ...source, count: generationCounts.get(source.question_id) || 0 }))
    .filter(source => source.count > 0);
  job.config.generation_count = plan.toGenerate.length;
  job.reused_count = plan.reused.length;
}

function reusableQuestions(runtime, job) {
  return (job.config.reuse_question_ids || []).map(questionId => {
    const question = runtime.questions.find(item => item.id === questionId);
    if (!question) throw new AppError('ai_reused_question_missing', 500);
    return question;
  });
}

function commitReuse(runtime, job) {
  commitReusableAiQuestions(runtime, job.id, job.config.reuse_question_ids || []);
  job.config.reuse_committed = true;
}

function releaseReuse(runtime, job) {
  if (!job.config.reuse_committed) {
    releaseReusableAiQuestions(runtime, job.id, job.config.reuse_question_ids || []);
  }
}

export function discardJob(runtime, job) {
  releaseReuse(runtime, job);
  const index = runtime.jobs.indexOf(job);
  if (index >= 0) runtime.jobs.splice(index, 1);
}

export function ensureJobCanStart(runtime, job) {
  if (job.config.generation_count && !providerFor(runtime, job.device_id)) {
    discardJob(runtime, job);
    fail('llm_not_configured', 409);
  }
}

function choiceLetter(value) {
  const match = String(value || '').toUpperCase().match(/[A-D]/);
  return match ? match[0] : '';
}

function subtreeLeaves(selectedIds, knowledge) {
  const selected = selectedIds.map(id => knowledge.find(node => node.id === id)).filter(Boolean);
  const codes = new Set(selected.map(node => node.code));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of knowledge) {
      const parent = node.parent_id ? knowledge.find(n => n.id === node.parent_id) : null;
      if (parent && codes.has(parent.code) && !codes.has(node.code)) {
        codes.add(node.code);
        changed = true;
      }
    }
  }
  const leaves = knowledge.filter(node => node.level === 3 && codes.has(node.code));
  return leaves.length ? leaves : selected;
}

function validateDrafts(items, counts, allowedCodes, difficultyFallback) {
  const byType = {};
  const drafts = [];
  for (const item of items) {
    if (!QTYPES.has(item.qtype) || !String(item.stem_latex || '').trim() || !String(item.answer_latex || '').trim()) {
      throw new AppError('ai_invalid_item', 502);
    }
    let answer = String(item.answer_latex).trim();
    if (item.qtype === 'single_choice') {
      const labels = Array.isArray(item.options) ? item.options.map(option => String(option.label || '').toUpperCase()).sort() : [];
      if (labels.length !== 4 || labels.join('') !== 'ABCD') throw new AppError('ai_invalid_options', 502);
      answer = choiceLetter(answer);
      if (!answer) throw new AppError('ai_invalid_item', 502);
    }
    if (!allowedCodes.includes(item.knowledge_code)) throw new AppError('ai_invalid_item', 502);
    const examPoint = String(item.exam_point || '').trim();
    if (!examPoint) throw new AppError('ai_invalid_item', 502);
    const code = item.knowledge_code;
    byType[item.qtype] = (byType[item.qtype] || 0) + 1;
    drafts.push({
      id: uuid(), qtype: item.qtype, stem_latex: item.stem_latex,
      options_json: item.qtype === 'single_choice' ? item.options : null,
      answer_latex: answer, knowledge_code: code,
      exam_point_raw: examPoint,
      explanation: String(item.explanation || '').trim(),
      difficulty: difficultyFallback,
      solution_steps: Array.isArray(item.solution_steps) ? item.solution_steps.filter(step => typeof step === 'string' && step.trim()).slice(0, 5) : [],
      score_x2: scoreFor(item.qtype), source: 'ai', status: 'published',
      content_hash: `ai-${uuid()}`,
    });
  }
  for (const [type, count] of Object.entries(byType)) {
    if ((counts[type] || 0) !== count) throw new AppError('ai_count_mismatch', 502);
  }
  for (const [type, count] of Object.entries(counts)) {
    if ((byType[type] || 0) !== count) throw new AppError('ai_count_mismatch', 502);
  }
  return drafts;
}

async function blindSolveDrafts(llm, drafts) {
  const solveInput = drafts.map((draft, index) => ({
    index: index + 1, qtype: draft.qtype, stem_latex: draft.stem_latex,
    options: draft.options_json?.map(option => ({ label: option.label, latex: option.latex })) || [],
  }));
  const raw = await llm([
    { role: 'system', content: SOLVE_SYSTEM },
    { role: 'user', content: JSON.stringify({ questions: solveInput }) },
  ], { temperature: 0.1, maxTokens: 6000 });
  const parsed = parseJson(raw);
  const answers = new Map((parsed.answers || []).map(item => [Number(item.index), String(item.answer_latex || '').trim()]));
  const verified = [];
  for (const [index, draft] of drafts.entries()) {
    const solved = answers.get(index + 1) || '';
    const expected = draft.qtype === 'single_choice' ? choiceLetter(draft.answer_latex) : normalizeText(draft.answer_latex);
    const actual = draft.qtype === 'single_choice' ? choiceLetter(solved) : normalizeText(solved);
    if (!actual || actual !== expected) throw new AppError('ai_blind_solve_mismatch', 502);
    verified.push(draft);
  }
  return verified;
}

function variantPrompt(sources) {
  const blocks = sources.map((source, index) => {
    const codes = source.knowledge.map(k => k.code).join(', ');
    const options = (source.options_json || []).map(option => `${option.label}. ${option.latex}`).join(' | ');
    return `【错题 ${index + 1}】\nsource_question_id: ${source.question_id}\n题型: ${source.qtype}\n难度: ${source.difficulty}\n知识点码: ${codes || '（沿用原题）'}\n题干: ${source.stem_latex}\n正确答案: ${source.answer_latex}\n选项: ${options || '无'}\n需要生成: ${source.count} 道`;
  }).join('\n\n');
  return `请为下列错题分别生成指定数量的变式题：\n\n${blocks}\n\n要求每道题都严格填写 source_question_id，并保持原题型和原知识点。只输出规定 JSON。`;
}

function validateVariantDrafts(items, sources) {
  const sourceMap = new Map(sources.map(source => [source.question_id, source]));
  const counts = new Map(sources.map(source => [source.question_id, 0]));
  const drafts = [];
  for (const item of items) {
    const source = sourceMap.get(item.source_question_id);
    if (!source) throw new AppError('ai_invalid_item', 502);
    if (item.qtype !== source.qtype) throw new AppError('ai_variant_type_mismatch', 502);
    const allowedCodes = source.knowledge.map(k => k.code);
    if (!allowedCodes.length) throw new AppError('ai_invalid_item', 502);
    const [draft] = validateDrafts([item], { [source.qtype]: 1 }, allowedCodes, source.difficulty);
    draft.difficulty = source.difficulty;
    draft.variant_of = source.question_id;
    drafts.push(draft);
    counts.set(source.question_id, counts.get(source.question_id) + 1);
  }
  for (const source of sources) {
    if (counts.get(source.question_id) !== source.count) throw new AppError('ai_count_mismatch', 502);
  }
  return drafts;
}

function buildVariantQuestion(draft) {
  const quality = {
    score_source: 'ai_derived', exam_point_raw: draft.exam_point_raw,
    approach_raw: draft.explanation, solution_steps: draft.solution_steps,
    variant_of: draft.variant_of,
  };
  return {
    id: draft.id, seq_label: '变式', year: null,
    section: draft.qtype === 'single_choice' ? 'choice' : draft.qtype === 'fill_blank' ? 'blank' : 'solution',
    qtype: draft.qtype, stem_latex: draft.stem_latex, options_json: draft.options_json,
    sub_items_json: null, answer_latex: draft.answer_latex, answer_source: 'ai_verified',
    solution_latex: null, score_x2: draft.score_x2, difficulty: draft.difficulty,
    source: 'ai', difficulty_obs: null, difficulty_source: 'variant_of_wrong',
    generator_meta_json: quality, rubric_json: null, rubric_version: null,
    content_hash: draft.content_hash, status: 'published', is_fixture: false,
    knowledge: [{ code: draft.knowledge_code, role: 'main', weight: 100 }],
    confidence: 100,
  };
}

export function createVariantJob(runtime, request, deviceId) {
  if (!Array.isArray(request.items) || !request.items.length) fail('invalid_input');
  if (request.items.length > 10) fail('invalid_input');
  const wrongIds = new Set(runtime.wrongBook.filter(item => item.device_id === deviceId).map(item => item.question_id));
  const seen = new Set();
  const items = [];
  for (const item of request.items) {
    const questionId = String(item.question_id || '');
    const count = Number(item.count);
    if (!wrongIds.has(questionId) || seen.has(questionId)) fail('invalid_input');
    if (!Number.isInteger(count) || count < 3 || count > 10) fail('invalid_input');
    const question = runtime.questions.find(q => q.id === questionId);
    if (!question) fail('not_found', 404);
    seen.add(questionId);
    items.push({ question_id: questionId, count });
  }
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total > MAX_QUESTIONS) fail('invalid_input');
  const sources = items.map(item => {
    const question = runtime.questions.find(q => q.id === item.question_id);
    return {
      question_id: item.question_id, count: item.count, qtype: question.qtype,
      difficulty: question.difficulty, stem_latex: question.stem_latex,
      answer_latex: question.answer_latex, options_json: question.options_json || [],
      knowledge: question.knowledge || [],
      exam_point: question.generator_meta_json?.exam_point_raw || '',
    };
  });
  const job = {
    id: uuid(), device_id: deviceId, kind: 'variant', status: 'queued', stage: '排队中',
    progress: 0, phase: 'queued', expected_count: total, generated_count: 0, verified_count: 0, reused_count: 0,
    detail: `已加入队列：为 ${items.length} 道错题生成 ${total} 道仿真题`,
    config: { origin: 'variant', items, sources, total, mode: 'drill', source_mode: 'ai' },
    drafts: null, ai_items: null, paper: null, error: null,
    created_at: nowIso(), updated_at: nowIso(),
  };
  planVariantReuse(runtime, job);
  runtime.jobs.push(job);
  return job;
}

export async function advanceVariantJob(runtime, job) {
  if (job.status === 'succeeded' || job.status === 'failed') return job;
  job.updated_at = nowIso();
  try {
    if (job.status === 'queued') {
      planVariantReuse(runtime, job);
      if (!job.config.generation_count) {
        job.drafts = [];
        job.ai_items = [];
        job.status = 'verifying';
        job.stage = '组装试卷';
        job.progress = 80;
        job.phase = 'assembling';
        job.detail = `已抽取 ${job.reused_count} 道已有仿真题，准备生成错题练习卷`;
        return job;
      }
      const llm = providerFor(runtime, job.device_id);
      if (!llm) throw new AppError('llm_not_configured', 409);
      job.phase = 'generating';
      job.stage = '生成仿真题';
      job.progress = 8;
      job.detail = `已抽取 ${job.reused_count} 道已有仿真题，正在为 ${job.config.items.length} 道错题生成 ${job.config.generation_count} 道新题…`;
      const raw = await llm([
        { role: 'system', content: VARIANT_SYSTEM },
        { role: 'user', content: variantPrompt(job.config.generation_sources) },
      ], { temperature: 0.5, maxTokens: 8000 });
      const parsed = parseJson(raw);
      if (!Array.isArray(parsed.items)) throw new AppError('ai_invalid_json', 502);
      job.drafts = validateVariantDrafts(parsed.items, job.config.generation_sources);
      job.generated_count = job.drafts.length;
      job.phase = 'format_check';
      job.stage = '校验题目格式';
      job.progress = 35;
      job.detail = `已生成 ${job.drafts.length}/${job.config.generation_count} 道新题，题型、选项和知识点格式校验通过`;
      job.status = 'generating';
      return job;
    }
    if (job.status === 'generating') {
      const llm = providerFor(runtime, job.device_id);
      if (!llm) throw new AppError('llm_not_configured', 409);
      job.phase = 'self_test';
      job.stage = '做题自测';
      job.progress = 50;
      job.detail = `正在独立重做 ${job.drafts.length} 道仿真题，逐题核对题干与标准答案…`;
      const verified = await blindSolveDrafts(llm, job.drafts);
      job.ai_items = verified;
      job.verified_count = verified.length;
      job.status = 'verifying';
      job.stage = '组装试卷';
      job.progress = 80;
      job.phase = 'assembling';
      job.detail = `自测通过 ${verified.length}/${job.drafts.length} 道仿真题，准备生成错题练习卷`;
      return job;
    }
    if (job.status === 'verifying') {
      job.phase = 'assembling';
      job.stage = '组装试卷';
      job.progress = 90;
      job.detail = `正在按错题分组编排 ${job.reused_count + job.ai_items.length} 道仿真题…`;
      const order = new Map(job.config.items.map((item, index) => [item.question_id, index]));
      const reusedItems = reusableQuestions(runtime, job).map(question => ({
        question_id: question.id, question: publicQuestion(question), fullQuestion: question,
        score_x2: question.score_x2, source_order: order.get(question.generator_meta_json?.variant_of) ?? 99,
      }));
      const generatedItems = job.ai_items.map(draft => {
        const fullQuestion = buildVariantQuestion(draft);
        return {
          question_id: draft.id, question: publicQuestion(fullQuestion), fullQuestion,
          score_x2: draft.score_x2, source_order: order.get(draft.variant_of) ?? 99,
        };
      });
      const aiItems = [...reusedItems, ...generatedItems].sort((a, b) => a.source_order - b.source_order);
      const items = aiItems.map(item => ({ question_id: item.question_id, question: item.question, score_x2: item.score_x2 }));
      const paper = {
        id: uuid(), device_id: job.device_id, mode: 'drill', source_mode: 'ai', origin: 'variant',
        title: `错题仿真练习（${job.config.items.length} 道错题）`,
        config_json: { origin: 'variant', variant_items: job.config.items, count: items.length },
        items_json: items,
        total_score_x2: items.reduce((sum, item) => sum + item.score_x2, 0),
        status: 'draft', created_at: nowIso(), submitted_at: null,
        adjustments: [`为 ${job.config.items.length} 道错题复用 ${reusedItems.length} 道、生成 ${generatedItems.length} 道仿真题，已通过盲解校验。`],
        actual_ratio: { real: 0, ai: items.length },
        dataset: runtime.dataset || 'production',
      };
      for (const item of generatedItems) runtime.questions.push(item.fullQuestion);
      runtime.papers.push(paper);
      commitReuse(runtime, job);
      runtime.composeStats.success += 1;
      job.paper = paper;
      job.status = 'succeeded';
      job.stage = '完成';
      job.phase = 'done';
      job.progress = 100;
      job.detail = `已完成：${items.length} 道仿真题（复用 ${reusedItems.length} 道），卷面 ${paper.total_score_x2 / 2} 分`;
      return job;
    }
    throw new AppError('ai_job_bad_state', 500);
  } catch (error) {
    releaseReuse(runtime, job);
    job.status = 'failed';
    job.stage = '失败';
    job.phase = 'failed';
    job.detail = '错题仿真卷生成失败，请重试';
    job.error = error instanceof AppError ? error.code : 'ai_generation_failed';
    job.error_detail = String(error?.stack || error?.message || error);
    runtime.composeStats.failure += 1;
    return job;
  }
}

export function createPaperJob(runtime, request, deviceId) {
  if (request.source_mode !== 'ai' && request.source_mode !== 'mixed') fail('invalid_input');
  if (request.type_counts) {
    for (const [type, n] of Object.entries(request.type_counts)) {
      if (!QTYPES.has(type) || !Number.isInteger(n) || n < 0) fail('invalid_input');
    }
  }
  const requested = targetCounts(request);
  const total = Object.values(requested).reduce((sum, n) => sum + n, 0);
  if (!total || total > MAX_QUESTIONS) fail('invalid_input');
  if (request.count !== undefined && request.count !== total) fail('invalid_input');
  if (!Array.isArray(request.concept_node_ids) || !request.concept_node_ids.length) fail('invalid_input');
  if (request.concept_node_ids.some(id => !runtime.knowledge.some(node => node.id === id))) fail('invalid_input');
  // Mixed papers are half real, half AI. For odd totals the real side gets the extra question.
  const aiCounts = request.source_mode === 'mixed' ? splitMixedCounts(requested, Math.floor(total / 2)) : requested;
  const aiTotal = Object.values(aiCounts).reduce((sum, n) => sum + n, 0);
  const job = {
    id: uuid(), device_id: deviceId, kind: 'paper', status: 'queued', stage: '排队中',
    progress: 0, phase: 'queued',
    expected_count: aiTotal, generated_count: 0, verified_count: 0, reused_count: 0,
    detail: aiTotal
      ? `已加入队列：需生成 ${aiTotal} 道 AI 题（${describeCounts(aiCounts)}）`
      : '本卷题量较少，未分配 AI 题，将直接准备真题',
    config: { ...request, type_counts: aiCounts, total_type_counts: requested, count: total, ai_count: aiTotal },
    drafts: null, ai_items: null, paper: null, error: null,
    created_at: nowIso(), updated_at: nowIso(),
  };
  planPaperReuse(runtime, job);
  runtime.jobs.push(job);
  return job;
}

export async function advancePaperJob(runtime, job) {
  if (job.status === 'succeeded' || job.status === 'failed') return job;
  job.updated_at = nowIso();
  try {
    if (job.status === 'queued') {
      if (!job.config.ai_count) {
        job.drafts = [];
        job.ai_items = [];
        job.status = 'verifying';
        job.stage = '组装试卷';
        job.progress = 80;
        job.phase = 'assembling';
        job.detail = '正在准备真题内容并计算试卷结构…';
        return job;
      }
      planPaperReuse(runtime, job);
      if (!job.config.generation_count) {
        job.drafts = [];
        job.ai_items = [];
        job.status = 'verifying';
        job.stage = '组装试卷';
        job.progress = 80;
        job.phase = 'assembling';
        job.detail = `已抽取 ${job.reused_count} 道已有仿真题，准备合并试卷…`;
        return job;
      }
      const leaves = subtreeLeaves(job.config.concept_node_ids, runtime.knowledge);
      const allowed = leaves.map(node => node.code);
      const leafText = leaves.map(node => `${node.code} ${node.name}`).join('\n');
      const realCount = job.config.count - job.config.ai_count;
      const prompt = `知识点码表（每题 knowledge_code 必须从中选择）：\n${leafText}\n\n本卷共 ${job.config.count} 题，其中真题 ${realCount} 题、AI 原创 ${job.config.ai_count} 题。\n已有仿真题抽取：${job.reused_count} 道。\nAI 需要生成：${JSON.stringify(job.config.generation_type_counts)}\n难度：${job.config.difficulty}\n模式：${job.config.mode}\n请严格按数量出题。`;
      job.phase = 'generating';
      job.stage = '生成题目';
      job.progress = 8;
      job.detail = `已抽取 ${job.reused_count} 道已有仿真题，正在生成 ${job.config.generation_count} 道新题（${describeCounts(job.config.generation_type_counts)}）…`;
      const llm = providerFor(runtime, job.device_id);
      if (!llm) throw new AppError('llm_not_configured', 409);
      const raw = await llm([
        { role: 'system', content: GENERATE_SYSTEM },
        { role: 'user', content: prompt },
      ], { temperature: 0.4, maxTokens: 8000 });
      const parsed = parseJson(raw);
      if (!Array.isArray(parsed.items)) throw new AppError('ai_invalid_json', 502);
      job.drafts = validateDrafts(parsed.items, job.config.generation_type_counts, allowed, job.config.difficulty || 'medium');
      job.generated_count = job.drafts.length;
      job.phase = 'format_check';
      job.stage = '校验题目格式';
      job.progress = 35;
      job.detail = `已抽取 ${job.reused_count} 道已有仿真题并生成 ${job.drafts.length}/${job.config.generation_count} 道新题，选择题选项、答案和知识点格式均已通过校验`;
      job.status = 'generating';
      return job;
    }
    if (job.status === 'generating') {
      const solveInput = job.drafts.map((draft, index) => ({
        index: index + 1, qtype: draft.qtype, stem_latex: draft.stem_latex,
        options: draft.options_json?.map(option => ({ label: option.label, latex: option.latex })) || [],
      }));
      job.phase = 'self_test';
      job.stage = '做题自测';
      job.progress = 50;
      job.detail = `正在独立重做 ${job.drafts.length} 道题，逐题核对题干与标准答案…`;
      const llm = providerFor(runtime, job.device_id);
      if (!llm) throw new AppError('llm_not_configured', 409);
      const raw = await llm([
        { role: 'system', content: SOLVE_SYSTEM },
        { role: 'user', content: JSON.stringify({ questions: solveInput }) },
      ], { temperature: 0.1, maxTokens: 6000 });
      const parsed = parseJson(raw);
      const answers = new Map((parsed.answers || []).map(item => [Number(item.index), String(item.answer_latex || '').trim()]));
      const verified = [];
      for (const [index, draft] of job.drafts.entries()) {
        const solved = answers.get(index + 1) || '';
        const expected = draft.qtype === 'single_choice' ? choiceLetter(draft.answer_latex) : normalizeText(draft.answer_latex);
        const actual = draft.qtype === 'single_choice' ? choiceLetter(solved) : normalizeText(solved);
        if (!actual || actual !== expected) throw new AppError('ai_blind_solve_mismatch', 502);
        verified.push(draft);
      }
      job.ai_items = verified;
      job.verified_count = verified.length;
      job.status = 'verifying';
      job.stage = '组装试卷';
      job.progress = 80;
      job.phase = 'assembling';
      job.detail = `自测通过 ${verified.length}/${job.drafts.length} 道题，准备合并试卷`;
      return job;
    }
    if (job.status === 'verifying') {
      const totalCounts = job.config.total_type_counts || job.config.type_counts;
      const aiCounts = job.config.type_counts || {};
      const realCounts = {};
      if (job.config.source_mode === 'mixed') {
        for (const [type, n] of Object.entries(totalCounts)) {
          const real = n - (aiCounts[type] || 0);
          if (real > 0) realCounts[type] = real;
        }
      }
      const realTotal = Object.values(realCounts).reduce((sum, n) => sum + n, 0);
      const reusedQuestions = reusableQuestions(runtime, job);
      job.phase = 'assembling';
      job.stage = '组装试卷';
      job.progress = 90;
      job.detail = job.config.source_mode === 'mixed'
        ? `正在合并 ${realTotal} 道真题与 ${reusedQuestions.length + job.ai_items.length} 道 AI 题，排序并计算分值…`
        : `正在整理 ${reusedQuestions.length + job.ai_items.length} 道 AI 题，排序并计算分值…`;
      let realItems = [];
      let adjustments = [];
      if (job.config.source_mode === 'mixed') {
        const realPaper = composePaper({
          ...job.config,
          source_mode: 'real',
          type_counts: realCounts,
          count: Object.values(realCounts).reduce((sum, n) => sum + n, 0),
          device_id: job.device_id,
        }, runtime);
        realItems = realPaper.items_json;
        adjustments = realPaper.adjustments;
      }
      const reusedItems = reusedQuestions.map(question => ({
        question_id: question.id, question: publicQuestion(question), score_x2: question.score_x2,
      }));
      const generatedItems = job.ai_items.map(draft => {
        const quality = {
          score_source: 'ai_derived', exam_point_raw: draft.exam_point_raw,
          approach_raw: draft.explanation, solution_steps: draft.solution_steps,
        };
        const fullQuestion = {
          id: draft.id, seq_label: 'AI', year: null,
          section: draft.qtype === 'single_choice' ? 'choice' : draft.qtype === 'fill_blank' ? 'blank' : 'solution',
          qtype: draft.qtype, stem_latex: draft.stem_latex, options_json: draft.options_json,
          sub_items_json: null, answer_latex: draft.answer_latex, answer_source: 'ai_verified',
          solution_latex: null, score_x2: draft.score_x2, difficulty: draft.difficulty,
          source: 'ai', difficulty_obs: null, difficulty_source: 'model_anchor_2019',
          generator_meta_json: quality, rubric_json: null, rubric_version: null,
          content_hash: draft.content_hash, status: 'published', is_fixture: false,
          knowledge: [{ code: draft.knowledge_code, role: 'main', weight: 100 }], confidence: 100,
        };
        return { question_id: draft.id, question: publicQuestion(fullQuestion), fullQuestion, score_x2: draft.score_x2 };
      });
      const aiItems = [...reusedItems, ...generatedItems];
      const items = [
        ...realItems,
        ...aiItems.map(item => ({ question_id: item.question_id, question: item.question, score_x2: item.score_x2 })),
      ];
      const sectionOrder = { single_choice: 0, fill_blank: 1, free_response: 2 };
      const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
      items.sort((a, b) => sectionOrder[a.question.qtype] - sectionOrder[b.question.qtype]
        || (job.config.mode === 'exam' ? difficultyOrder[a.question.difficulty] - difficultyOrder[b.question.difficulty] : 0));
      const paper = {
        id: uuid(), device_id: job.device_id, mode: job.config.mode, source_mode: job.config.source_mode,
        config_json: { ...job.config, type_counts: totalCounts, ai_type_counts: aiCounts },
        items_json: items,
        total_score_x2: items.reduce((sum, item) => sum + item.score_x2, 0),
        status: 'draft', created_at: nowIso(), submitted_at: null,
        adjustments: [...adjustments, ...(aiItems.length ? [`AI 题复用 ${reusedItems.length} 道、生成 ${generatedItems.length} 道，生成题已通过盲解校验。`] : ['题量较少，本卷未分配 AI 原创题。'])],
        actual_ratio: { real: realItems.length, ai: aiItems.length },
        dataset: runtime.dataset || 'production',
      };
      for (const item of generatedItems) {
        runtime.questions.push(item.fullQuestion);
      }
      runtime.papers.push(paper);
      commitReuse(runtime, job);
      runtime.composeStats.success += 1;
      job.paper = paper;
      job.status = 'succeeded';
      job.stage = '完成';
      job.phase = 'done';
      job.progress = 100;
      job.detail = `已完成：${items.length} 道题（复用 ${reusedItems.length} 道），卷面 ${paper.total_score_x2 / 2} 分`;
      return job;
    }
    throw new AppError('ai_job_bad_state', 500);
  } catch (error) {
    releaseReuse(runtime, job);
    job.status = 'failed';
    job.stage = '失败';
    job.phase = 'failed';
    job.detail = '组卷失败，请重试';
    job.error = error instanceof AppError ? error.code : 'ai_generation_failed';
    job.error_detail = String(error?.stack || error?.message || error);
    runtime.composeStats.failure += 1;
    return job;
  }
}
