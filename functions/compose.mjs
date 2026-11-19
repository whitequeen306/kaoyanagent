import { fail, uuid, nowIso, QTYPES, SOURCE_MODES, MODES, DIFFICULTIES, MAX_QUESTIONS } from './model.mjs';
import { publicQuestion } from './grade.mjs';

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function poolFor(questions, { nodeIds, qtypes, yearFrom, yearTo, deviceId, attempts, excludeDone }, source) {
  return questions.filter(q => q.status === 'published' && q.source === source
    && qtypes.includes(q.qtype)
    && q.knowledge.some(k => nodeIds.includes(k.code))
    && (!excludeDone || !attempts.some(a => a.device_id === deviceId && a.question_id === q.id && a.score_x2 === a.max_score_x2))
    && (!yearFrom || !q.year || q.year >= yearFrom)
    && (!yearTo || !q.year || q.year <= yearTo));
}
function expandToSubtree(codes, allNodes) {
  const expanded = new Set(codes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of allNodes) {
      const parentCode = node.parent_id ? allNodes.find(n => n.id === node.parent_id)?.code : null;
      if (parentCode && expanded.has(parentCode) && !expanded.has(node.code)) { expanded.add(node.code); changed = true; }
    }
  }
  return [...expanded];
}
function expandToParent(codes, allNodes) {
  const withParents = new Set(codes);
  for (const code of codes) {
    const node = allNodes.find(n => n.code === code);
    // Promote a leaf to its chapter, but never promote a whole chapter to the
    // subject: otherwise unrelated chapters silently enter the paper.
    if (node?.level !== 3) continue;
    const parent = node.parent_id ? allNodes.find(n => n.id === node.parent_id) : null;
    if (parent) withParents.add(parent.code);
  }
  // A parent node stands for its whole subtree, so include every descendant.
  return expandToSubtree([...withParents], allNodes);
}

function composeByType(request, runtime) {
  const { questions, knowledge, attempts } = runtime;
  const conceptNodeIds = request.concept_node_ids;
  if (!Array.isArray(conceptNodeIds) || !conceptNodeIds.length) fail('invalid_input');
  const selectedCodes = conceptNodeIds.map(id => knowledge.find(n => n.id === id)?.code).filter(Boolean);
  if (selectedCodes.length !== conceptNodeIds.length) fail('invalid_input');
  let nodeIds = expandToSubtree(selectedCodes, knowledge);
  const rawCounts = request.type_counts;
  if (!rawCounts || typeof rawCounts !== 'object' || Array.isArray(rawCounts)) fail('invalid_input');
  const entries = Object.entries(rawCounts).filter(([type, n]) => QTYPES.has(type) && Number.isInteger(n) && n > 0);
  if (entries.some(([type, n]) => !QTYPES.has(type) || !Number.isInteger(n) || n < 0)) fail('invalid_input');
  if (!entries.length) fail('invalid_input');
  const count = entries.reduce((sum, [, n]) => sum + n, 0);
  if (count < 1 || count > MAX_QUESTIONS) fail('invalid_input');
  if (request.count !== undefined && request.count !== count) fail('invalid_input');
  if (!SOURCE_MODES.has(request.source_mode) || !MODES.has(request.mode) || !DIFFICULTIES.has(request.difficulty)) fail('invalid_input');
  const deviceId = request.device_id;
  const qtypes = entries.map(([type]) => type);
  const req = { nodeIds, qtypes, yearFrom: request.year_from, yearTo: request.year_to, deviceId, attempts, excludeDone: request.exclude_done !== false };
  const adjustments = [];
  const allowed = request.source_mode === 'real' ? ['real'] : request.source_mode === 'ai' ? ['ai'] : ['real', 'ai'];
  const targetFor = (type, n) => {
    if (request.source_mode === 'real') return { real: n, ai: 0 };
    if (request.source_mode === 'ai') return { real: 0, ai: n };
    return { real: Math.ceil(n / 2), ai: n - Math.ceil(n / 2) };
  };
  let pools = allowed.map(source => ({ source, rows: poolFor(questions, req, source).filter(q => q.difficulty === request.difficulty) }));
  const short = () => entries.some(([type, n]) => {
    const targets = targetFor(type, n);
    return pools.some(p => p.rows.filter(q => q.qtype === type).length < targets[p.source]);
  });
  if (short()) {
    const expanded = expandToParent(nodeIds, knowledge);
    if (expanded.length !== nodeIds.length) {
      req.nodeIds = expanded; nodeIds = expanded;
      pools = allowed.map(source => ({ source, rows: poolFor(questions, req, source).filter(q => q.difficulty === request.difficulty) }));
      adjustments.push('候选题不足，已扩展到父级知识范围。');
    }
  }
  if (short()) {
    pools = allowed.map(source => ({ source, rows: poolFor(questions, req, source) }));
    adjustments.push('目标难度题量不足，已纳入相邻难度题。');
  }
  const chosen = [];
  const used = new Set();
  for (const [type, n] of entries) {
    const targets = targetFor(type, n);
    const realRows = pools.find(p => p.source === 'real')?.rows.filter(q => q.qtype === type) || [];
    const aiRows = pools.find(p => p.source === 'ai')?.rows.filter(q => q.qtype === type) || [];
    const picked = [
      ...shuffle(realRows).slice(0, Math.min(targets.real, realRows.length)),
      ...shuffle(aiRows).slice(0, Math.min(targets.ai, aiRows.length)),
    ];
    const pickedIds = new Set(picked.map(q => q.id));
    for (const q of shuffle([...realRows, ...aiRows])) {
      if (picked.length >= n) break;
      if (!pickedIds.has(q.id)) { picked.push(q); pickedIds.add(q.id); }
    }
    if (picked.length < n) fail('insufficient_questions', 409);
    for (const q of picked.slice(0, n)) {
      if (used.has(q.id)) continue;
      used.add(q.id); chosen.push(q);
    }
    if (chosen.length < entries.reduce((sum, [t, m]) => sum + (t === type ? m : 0), 0)) fail('insufficient_questions', 409);
  }
  if (chosen.length !== count) fail('insufficient_questions', 409);
  const sectionOrder = { single_choice: 0, fill_blank: 1, free_response: 2 };
  const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
  chosen.sort((a, b) => sectionOrder[a.qtype] - sectionOrder[b.qtype]
    || (request.mode === 'exam' ? difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty] : 0));
  const items = chosen.map(question => ({ question_id: question.id, question: structuredClone(publicQuestion(question)), score_x2: question.score_x2 }));
  const realCount = chosen.filter(q => q.source === 'real').length;
  return {
    id: uuid(), device_id: deviceId, mode: request.mode, source_mode: request.source_mode,
    config_json: { concept_node_ids: conceptNodeIds, type_counts: Object.fromEntries(entries), count, difficulty: request.difficulty },
    items_json: items, total_score_x2: items.reduce((sum, item) => sum + item.score_x2, 0),
    status: 'draft', created_at: nowIso(), submitted_at: null,
    adjustments, actual_ratio: { real: realCount, ai: chosen.length - realCount },
    dataset: runtime.dataset || 'production',
  };
}

export function composePaper(request, runtime) {
  if (request.type_counts) return composeByType(request, runtime);
  const { questions, knowledge, attempts } = runtime;
  const conceptNodeIds = request.concept_node_ids;
  if (!Array.isArray(conceptNodeIds) || !conceptNodeIds.length) fail('invalid_input');
  const selectedCodes = conceptNodeIds.map(id => knowledge.find(n => n.id === id)?.code).filter(Boolean);
  if (selectedCodes.length !== conceptNodeIds.length) fail('invalid_input');
  let nodeIds = expandToSubtree(selectedCodes, knowledge);
  const qtypes = request.qtypes;
  if (!Array.isArray(qtypes) || !qtypes.length || qtypes.some(t => !QTYPES.has(t))) fail('invalid_input');
  const count = request.count;
  if (!Number.isInteger(count) || count < 1 || count > MAX_QUESTIONS) fail('invalid_input');
  if (!SOURCE_MODES.has(request.source_mode) || !MODES.has(request.mode) || !DIFFICULTIES.has(request.difficulty)) fail('invalid_input');
  const deviceId = request.device_id;
  const req = { nodeIds, qtypes, yearFrom: request.year_from, yearTo: request.year_to, deviceId, attempts, excludeDone: request.exclude_done !== false };
  const adjustments = [];
  const allowed = request.source_mode === 'real' ? ['real'] : request.source_mode === 'ai' ? ['ai'] : ['real', 'ai'];
  const realTarget = request.source_mode === 'real' ? count : request.source_mode === 'ai' ? 0 : Math.ceil(count / 2);
  const aiTarget = request.source_mode === 'ai' ? count : request.source_mode === 'real' ? 0 : count - realTarget;
  let pools = allowed.map(source => ({ source, rows: poolFor(questions, req, source).filter(q => q.difficulty === request.difficulty) }));
  const total = () => pools.reduce((n, p) => n + p.rows.length, 0);
  const short = () => pools.some(p => p.rows.length < (p.source === 'real' ? realTarget : aiTarget));
  if (short()) {
    const expanded = expandToParent(nodeIds, knowledge);
    if (expanded.length !== nodeIds.length) {
      req.nodeIds = expanded; nodeIds = expanded;
      pools = allowed.map(source => ({ source, rows: poolFor(questions, req, source).filter(q => q.difficulty === request.difficulty) }));
      adjustments.push('候选题不足，已扩展到父级知识范围。');
    }
  }
  if (short()) {
    pools = allowed.map(source => ({ source, rows: poolFor(questions, req, source) }));
    adjustments.push('目标难度题量不足，已纳入相邻难度题。');
  }
  if (total() < count) fail('insufficient_questions', 409);
  const chosen = [];
  for (const { source, rows } of pools) {
    const target = source === 'real' ? realTarget : aiTarget;
    chosen.push(...shuffle(rows).slice(0, Math.min(target, rows.length)));
  }
  const used = new Set(chosen.map(q => q.id));
  // Only fill from an allowed source. A real-only request never receives AI questions.
  for (const { rows } of pools) {
    for (const q of shuffle(rows)) {
      if (chosen.length >= count) break;
      if (!used.has(q.id)) { chosen.push(q); used.add(q.id); }
    }
  }
  if (chosen.length < count) fail('insufficient_questions', 409);
  chosen.length = count;
  if (request.source_mode === 'mixed') {
    const actualReal = chosen.filter(q => q.source === 'real').length;
    if (Math.abs(actualReal * 2 - count) > 1) adjustments.push(`真题与 AI 目标各半，实际为 ${actualReal} : ${count - actualReal}。`);
  }
  const sectionOrder = { single_choice: 0, fill_blank: 1, free_response: 2 };
  const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
  chosen.sort((a, b) => sectionOrder[a.qtype] - sectionOrder[b.qtype]
    || (request.mode === 'exam' ? difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty] : 0));
  const items = chosen.map(question => ({ question_id: question.id, question: structuredClone(publicQuestion(question)), score_x2: question.score_x2 }));
  const realCount = chosen.filter(q => q.source === 'real').length;
  return {
    id: uuid(), device_id: deviceId, mode: request.mode, source_mode: request.source_mode,
    config_json: { concept_node_ids: conceptNodeIds, qtypes, count, difficulty: request.difficulty },
    items_json: items, total_score_x2: items.reduce((s, i) => s + i.score_x2, 0),
    status: 'draft', created_at: nowIso(), submitted_at: null,
    adjustments, actual_ratio: { real: realCount, ai: chosen.length - realCount },
    dataset: runtime.dataset || 'production',
  };
}
