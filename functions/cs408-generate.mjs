import { AppError, fail, uuid, nowIso, MAX_QUESTIONS } from './model.mjs';
import { publicQuestion } from './grade.mjs';
import {
  blindSolveDrafts, choiceLetter, escapeHtml, jobProvider, parseJson, releaseReuse,
} from './generate.mjs';
import { isJobBusy, withJobLock } from './job-lock.mjs';

const GENERATE_SYSTEM_408 = `你是考研 408（数据结构、计算机组成原理、操作系统、计算机网络）的命题老师。根据给定章节和数量生成题目。
硬性要求：
1. 每题必须严格对应给定章节码之一，不得超纲。
2. 单项选择题必须有 A/B/C/D 四个选项且恰有一个正确；综合应用题必须有完整小问和可核验的参考答案。
3. 题干和选项用纯文本，不要输出 HTML，不要引用不存在的图号。综合题的小问用（1）（2）写在 stem 里。
4. 每道综合题给 reference_answer（完整参考答案）和 key_points（2-6 条关键结论）；单选给 explanation。
5. 只输出 JSON，不要代码块：
{"items":[{"qtype":"single_choice","stem":"题干","options":[{"label":"A","text":"..."}],"answer_latex":"B","knowledge_code":"DS4","exam_point":"...","difficulty":"medium","explanation":"..."},{"qtype":"free_response","stem":"题干（1）...（2）...","reference_answer":"参考答案","key_points":["结论1","结论2"],"knowledge_code":"DS4","exam_point":"...","difficulty":"medium"}]}`;

function buildCs408PracticeQuestion(draft) {
  const stem = escapeHtml(draft.stem_text || draft.stem_latex).replace(/\n/g, '<br>');
  const answer = escapeHtml(draft.reference_answer || draft.explanation).replace(/\n/g, '<br>');
  const isFree = draft.qtype === 'free_response';
  return {
    id: draft.id, subject: 'cs408', seq_label: isFree ? 'AI 综合' : 'AI', year: null, number: null,
    title: isFree ? '408 AI 综合题' : '408 AI 仿真题', paper_id: null,
    section: isFree ? 'solution' : 'choice', qtype: draft.qtype,
    question_html: `<p class="paragraph question">${stem}</p>`,
    question_text: draft.stem_text || draft.stem_latex,
    stem_latex: draft.stem_text || draft.stem_latex,
    options: isFree ? [] : draft.options || [],
    options_json: isFree ? null : draft.options_json || [],
    sub_items_json: null, answer_latex: isFree ? '' : draft.answer_latex,
    answer_source: isFree ? 'ai_reference' : 'ai_verified',
    answer_html: `<p>${answer}</p>`, answer_text: draft.reference_answer || draft.explanation,
    explanation: draft.reference_answer || draft.explanation, has_explanation: true,
    figures: [], has_figure: false, figure_asset_id: null, figure_assets: [],
    solution_latex: null, score_x2: isFree ? 20 : 4, score_source: 'ai_derived',
    difficulty: 'medium', source: 'ai', difficulty_obs: null, difficulty_source: 'ai_generated',
    generator_meta_json: {
      exam_point_raw: draft.exam_point_raw, approach_raw: draft.reference_answer || draft.explanation,
      solution_steps: [], variant_of: null,
    },
    rubric_json: null, rubric_version: null, content_hash: draft.content_hash,
    status: 'published', is_fixture: false,
    knowledge: [{ code: draft.knowledge_code, role: 'main', weight: 100 }],
    ai_kind: 'practice',
    data_notes: [isFree ? '408 AI 综合题，参考答案已做 AI 复核；交卷后按解析自评。' : '408 AI 仿真题，已通过盲解校验。'],
  };
}

function validateCs408GeneratedDrafts(items, codes, counts) {
  const expected = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!Array.isArray(items) || items.length !== expected) throw new AppError('ai_count_mismatch', 502);
  const seen = { single_choice: 0, free_response: 0 };
  const drafts = [];
  for (const item of items) {
    const qtype = item.qtype === 'free_response' ? 'free_response' : 'single_choice';
    const stem = String(item.stem || item.stem_text || item.stem_latex || '').trim();
    if (!stem) throw new AppError('ai_invalid_item', 502);
    if (!codes.includes(item.knowledge_code)) throw new AppError('ai_invalid_item', 502);
    const examPoint = String(item.exam_point || '408 AI 仿真').trim();
    if (qtype === 'single_choice') {
      const options = Array.isArray(item.options) ? item.options : [];
      const labels = options.map(option => String(option.label || '').toUpperCase()).sort();
      const texts = options.map(option => String(option.text || option.latex || '').trim());
      if (labels.length !== 4 || labels.join('') !== 'ABCD' || texts.some(text => !text) || new Set(texts).size !== 4) throw new AppError('ai_invalid_options', 502);
      const answer = choiceLetter(item.answer_latex || item.answer || '');
      const explanation = String(item.explanation || '').trim();
      if (!answer || !explanation) throw new AppError('ai_invalid_item', 502);
      const normalizedOptions = options.map(option => ({ label: String(option.label).toUpperCase(), text: String(option.text || option.latex || '').trim() }));
      drafts.push({
        id: uuid(), subject: 'cs408', qtype, stem_text: stem, stem_latex: stem,
        options: normalizedOptions, options_json: normalizedOptions.map(option => ({ label: option.label, latex: option.text })),
        answer_latex: answer, knowledge_code: item.knowledge_code, exam_point_raw: examPoint,
        explanation, difficulty: 'medium', solution_steps: [], score_x2: 4, source: 'ai', status: 'published',
        content_hash: `ai-${uuid()}`,
      });
    } else {
      const reference = String(item.reference_answer || item.answer || item.solution || '').trim();
      const keyPoints = Array.isArray(item.key_points) ? item.key_points.filter(point => typeof point === 'string' && point.trim()).slice(0, 6) : [];
      if (!reference || keyPoints.length < 2) throw new AppError('ai_invalid_item', 502);
      drafts.push({
        id: uuid(), subject: 'cs408', qtype, stem_text: stem, stem_latex: stem,
        options: [], options_json: null, answer_latex: '', knowledge_code: item.knowledge_code,
        exam_point_raw: examPoint, explanation: reference, reference_answer: reference, key_points: keyPoints,
        difficulty: 'medium', solution_steps: keyPoints, score_x2: 20, source: 'ai', status: 'published',
        content_hash: `ai-${uuid()}`,
      });
    }
    seen[qtype] += 1;
  }
  for (const qtype of ['single_choice', 'free_response']) {
    if ((counts[qtype] || 0) !== seen[qtype]) throw new AppError('ai_count_mismatch', 502);
  }
  return drafts;
}

async function reviewCs408FreeDrafts(llm, drafts) {
  if (!drafts.length) return [];
  const input = drafts.map((draft, index) => ({
    index: index + 1, stem: draft.stem_text, reference_answer: draft.reference_answer, key_points: draft.key_points,
  }));
  const raw = await llm([
    { role: 'system', content: '你是独立的 408 阅卷老师。核对题干是否完整可解、参考答案是否覆盖所有小问、关键结论是否一致。只输出 JSON：{"items":[{"index":1,"consistent":true,"confidence":0-100,"issues":""}]}。不要输出代码块。' },
    { role: 'user', content: JSON.stringify({ questions: input }) },
  ], { temperature: 0.1, maxTokens: 3000 });
  const parsed = parseJson(raw);
  const rows = Array.isArray(parsed.items) ? parsed.items : [];
  const byIndex = new Map(rows.map(row => [Number(row.index), row]));
  return drafts.filter((_, index) => {
    const row = byIndex.get(index + 1);
    if (!row || row.consistent !== true) throw new AppError('ai_review_failed', 502);
    return true;
  });
}

function cs408RealPool(runtime, codes, qtype) {
  return runtime.questions.filter(question => question.subject === 'cs408'
    && question.source === 'real'
    && question.status === 'published'
    && question.qtype === qtype
    && question.knowledge.some(node => codes.includes(node.code)));
}

function nodeCodes(runtime, node) {
  if (node.level === 1) return runtime.cs408Knowledge.filter(item => item.parent_id === node.id && item.level === 2).map(item => item.code);
  if (node.level === 3) return runtime.cs408Knowledge.filter(item => item.id === node.parent_id).map(item => item.code);
  return [node.code];
}

function splitCounts(typeCounts, sourceMode) {
  if (sourceMode === 'ai') return { ai: { ...typeCounts }, real: {} };
  const single = typeCounts.single_choice || 0;
  const free = typeCounts.free_response || 0;
  const ai = {
    single_choice: single ? Math.max(1, Math.floor(single / 2)) : 0,
    free_response: Math.floor(free / 2),
  };
  return {
    ai,
    real: {
      single_choice: single - ai.single_choice,
      free_response: free - ai.free_response,
    },
  };
}

export function createCs408PaperJob(runtime, request, deviceId) {
  if (!Array.isArray(request.node_ids) || !request.node_ids.length) fail('invalid_input');
  if (!['ai', 'mixed'].includes(request.source_mode)) fail('invalid_input');
  const nodes = request.node_ids.map(id => runtime.cs408Knowledge.find(node => node.id === id));
  if (nodes.some(node => !node)) fail('invalid_input');
  const codes = [...new Set(nodes.flatMap(node => nodeCodes(runtime, node)))];
  const typeCounts = request.type_counts && typeof request.type_counts === 'object'
    ? Object.fromEntries(Object.entries(request.type_counts).filter(([type, value]) => ['single_choice', 'free_response'].includes(type) && Number.isInteger(value) && value > 0))
    : {};
  const total = Object.values(typeCounts).reduce((sum, value) => sum + value, 0);
  if (!total || total > MAX_QUESTIONS) fail('invalid_input');
  const { ai, real } = splitCounts(typeCounts, request.source_mode);
  const aiTotal = Object.values(ai).reduce((sum, value) => sum + value, 0);
  if (!aiTotal) fail('invalid_input');
  for (const [qtype, count] of Object.entries(real)) {
    if (count > 0 && cs408RealPool(runtime, codes, qtype).length < count) fail('insufficient_questions', 409);
  }
  const job = {
    id: uuid(), device_id: deviceId, kind: 'cs408_paper', status: 'queued', stage: '排队中',
    progress: 0, phase: 'queued', expected_count: total, generated_count: 0, verified_count: 0, reused_count: 0,
    detail: `已加入 408 AI 出题队列：${typeCounts.single_choice || 0} 道单选${typeCounts.free_response ? ` + ${typeCounts.free_response} 道综合` : ''}`,
    config: {
      subject: 'cs408', origin: 'cs408_practice', node_ids: request.node_ids,
      node_names: nodes.map(node => node.name), codes, type_counts: typeCounts,
      ai_counts: ai, real_counts: real,
      mode: request.mode === 'exam' ? 'exam' : 'drill', source_mode: request.source_mode,
      ai_count: aiTotal, total,
    },
    diagnosis: null, drafts: null, ai_items: null, paper: null, error: null,
    created_at: nowIso(), updated_at: nowIso(),
  };
  runtime.jobs.push(job);
  return job;
}

export function advanceCs408PaperJob(runtime, job) {
  if (isJobBusy(runtime, job.id)) return Promise.resolve(job);
  return withJobLock(runtime, job.id, () => advanceCs408PaperJobNow(runtime, job));
}

async function advanceCs408PaperJobNow(runtime, job) {
  if (job.status === 'succeeded' || job.status === 'failed') return job;
  job.updated_at = nowIso();
  try {
    if (job.status === 'queued') {
      const llm = jobProvider(runtime, job);
      job.status = 'generating';
      job.phase = 'generating';
      job.stage = '生成 408 题目';
      job.progress = 10;
      job.detail = `正在为 ${job.config.node_names.slice(0, 3).join('、')} 生成 ${job.config.ai_count} 道 408 题…`;
      const need = `单选题 ${job.config.ai_counts.single_choice || 0} 道，综合应用题 ${job.config.ai_counts.free_response || 0} 道`;
      const prompt = `章节：${job.config.node_names.join('、')}\n章节码：${job.config.codes.join('、')}\n请生成：${need}，严格使用给定章节码。`;
      const raw = await llm([{ role: 'system', content: GENERATE_SYSTEM_408 }, { role: 'user', content: prompt }], { temperature: 0.5, maxTokens: 8000 });
      const parsed = parseJson(raw);
      job.drafts = validateCs408GeneratedDrafts(parsed.items, job.config.codes, job.config.ai_counts);
      job.generated_count = job.drafts.length;
      job.status = 'generating';
      job.phase = 'format_check';
      job.stage = '校验题目格式';
      job.progress = 35;
      job.detail = `已生成 ${job.drafts.length} 道 408 题，选项、答案、小问和章节码校验通过`;
      return job;
    }
    if (job.status === 'generating') {
      const llm = jobProvider(runtime, job);
      job.phase = 'self_test';
      job.stage = '做题自测';
      job.progress = 55;
      const singleDrafts = job.drafts.filter(draft => draft.qtype === 'single_choice');
      const freeDrafts = job.drafts.filter(draft => draft.qtype === 'free_response');
      job.detail = singleDrafts.length && freeDrafts.length
        ? `正在盲解 ${singleDrafts.length} 道单选，并复核 ${freeDrafts.length} 道综合题…`
        : singleDrafts.length ? `正在独立重做 ${singleDrafts.length} 道 408 仿真题…` : `正在复核 ${freeDrafts.length} 道 408 综合题…`;
      const solved = singleDrafts.length ? await blindSolveDrafts(llm, singleDrafts) : [];
      const reviewed = freeDrafts.length ? await reviewCs408FreeDrafts(llm, freeDrafts) : [];
      job.ai_items = [...solved, ...reviewed];
      job.verified_count = job.ai_items.length;
      job.status = 'verifying';
      job.phase = 'assembling';
      job.stage = '组装试卷';
      job.progress = 80;
      job.detail = `校验通过 ${job.verified_count}/${job.drafts.length} 道（单选盲解，综合题 AI 复核），准备拼卷`;
      return job;
    }
    if (job.status === 'verifying') {
      const aiQuestions = job.ai_items.map(buildCs408PracticeQuestion);
      const realQuestions = [];
      for (const [qtype, count] of Object.entries(job.config.real_counts)) {
        if (!count) continue;
        const pool = cs408RealPool(runtime, job.config.codes, qtype);
        const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
        if (picked.length < count) throw new AppError('insufficient_questions', 409);
        realQuestions.push(...picked);
      }
      const questions = [...realQuestions, ...aiQuestions];
      const singleCount = questions.filter(question => question.qtype === 'single_choice').length;
      const items = questions.map(question => ({
        question_id: question.id, question: structuredClone(publicQuestion(question)), score_x2: question.score_x2,
      }));
      const paper = {
        id: uuid(), device_id: job.device_id, subject: 'cs408', mode: job.config.mode,
        source_mode: job.config.source_mode, origin: 'cs408_practice',
        title: `${job.config.node_names.slice(0, 2).join(' · ')} · 408 ${job.config.source_mode === 'ai' ? 'AI 仿真' : '混合'}练习`,
        config_json: {
          cs408_node_ids: job.config.node_ids, cs408_node_names: job.config.node_names,
          cs408_count: questions.length, cs408_type_counts: job.config.type_counts,
          cs408_source_mode: job.config.source_mode, cs408_ai_count: aiQuestions.length,
          cs408_real_count: realQuestions.length, cs408_auto_score_x2: singleCount * 4,
        },
        items_json: items,
        total_score_x2: items.reduce((sum, item) => sum + item.score_x2, 0),
        status: 'draft', created_at: nowIso(), submitted_at: null,
        adjustments: [`AI 生成 ${aiQuestions.length} 道、真题 ${realQuestions.length} 道；单选已盲解，综合题参考答案已 AI 复核。`],
        actual_ratio: { real: realQuestions.length, ai: aiQuestions.length },
        dataset: runtime.dataset || 'production',
      };
      for (const question of aiQuestions) runtime.questions.push(question);
      runtime.papers.push(paper);
      runtime.composeStats.success += 1;
      job.paper = paper;
      job.status = 'succeeded';
      job.stage = '完成';
      job.phase = 'done';
      job.progress = 100;
      job.detail = `已完成 ${questions.length} 道 408 ${job.config.source_mode === 'ai' ? 'AI 仿真' : '混合'}练习`;
      return job;
    }
    return job;
  } catch (error) {
    releaseReuse(runtime, job);
    runtime.composeStats.failure += 1;
    job.status = 'failed';
    job.stage = '失败';
    job.error = error instanceof AppError ? error.code : 'internal_error';
    job.detail = error instanceof Error ? error.message : '408 AI 出题失败';
    return job;
  }
}
