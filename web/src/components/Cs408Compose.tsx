import { useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import type { Knowledge } from '../types';

export interface Cs408ComposeOptions {
  mode: 'exam' | 'drill';
  source_mode: 'real' | 'ai' | 'mixed';
  type_counts: { single_choice: number; free_response: number };
}

export function Cs408Compose({ busy, aiConfigured, onOpenSettings, onStart }: {
  busy: boolean;
  aiConfigured: boolean;
  onOpenSettings: () => void;
  onStart: (nodeIds: string[], options: Cs408ComposeOptions) => void;
}) {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'exam' | 'drill'>('drill');
  const [sourceMode, setSourceMode] = useState<'real' | 'ai' | 'mixed'>('real');
  const [typeCounts, setTypeCounts] = useState({ single_choice: 10, free_response: 0 });

  useEffect(() => {
    request<{ items: Knowledge[] }>('/api/cs408/knowledge')
      .then(data => setKnowledge(data.items || []))
      .catch(() => setKnowledge([]))
      .finally(() => setLoading(false));
  }, []);

  const subjects = knowledge.filter(node => node.level === 1);
  const searchResults = query
    ? knowledge.filter(node => node.name.includes(query) || node.aliases?.some(alias => alias.includes(query)))
    : [];
  const totalCount = typeCounts.single_choice + typeCounts.free_response;
  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  function toggleExpand(id: string) {
    setExpanded(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  function setTypeCount(type: 'single_choice' | 'free_response', value: number) {
    const other = totalCount - typeCounts[type];
    const safe = Math.max(0, Math.min(30 - other, Number.isFinite(value) ? value : 0));
    setTypeCounts(current => ({ ...current, [type]: safe }));
  }

  return <section className="simple-page cs408-page cs408-compose-page">
    <span className="eyebrow">408 · 自由练习</span>
    <h1>按知识点组卷</h1>
    <p>从大纲的 4 门课和章节里选题，按模式、题型和题量生成 408 练习。单选交卷自动判分，综合题对照解析自评。</p>
    <div className="compose-layout no-print">
      <section className="panel knowledge-panel">
        <div className="section-heading"><span>01</span><div><h2>选择知识点</h2><p>章节标签由题库自动标注，个别题可能跨章节。</p></div></div>
        <label className="search-box"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="试试：二叉树、Cache、进程、TCP" /></label>
        {loading ? <div className="empty-state">正在加载 408 知识树…</div> : query ? <div className="knowledge-grid search-live">
          {searchResults.map(node => <button key={node.id} className={`knowledge-chip ${selected.includes(node.id) ? 'selected' : ''}`} onClick={() => toggle(node.id)}>
            <span className="chip-dot" />{node.name}<small>{node.level === 1 ? '整门' : node.level === 2 ? '章节' : '考点'}{node.question_count ? ` · ${node.question_count}` : ''}</small>
          </button>)}
          {!searchResults.length && <div className="empty-state">没有匹配的知识点</div>}
        </div> : <div className="knowledge-tree">
          {subjects.map(subject => <div className="tree-subject" key={subject.id}>
            <button className={`knowledge-chip subject-chip ${selected.includes(subject.id) ? 'selected' : ''}`} onClick={() => toggle(subject.id)}>
              <span className="chip-dot" />{subject.name}<small>整门 · {subject.question_count || 0} 题</small>
            </button>
            <div className="tree-chapters">{knowledge.filter(node => node.parent_id === subject.id && node.level === 2).map(chapter => <div className="chapter-block" key={chapter.id}>
              <button className={`knowledge-chip chapter-chip ${selected.includes(chapter.id) ? 'selected' : ''}`} onClick={() => { toggle(chapter.id); toggleExpand(chapter.id); }}>
                <span className="chip-dot" />{chapter.name}<span className="cs408-chip-count">{chapter.question_count || 0} 题</span><span className="expand-mark">{expanded.includes(chapter.id) ? '−' : '+'}</span>
              </button>
              {expanded.includes(chapter.id) && <div className="leaf-list">{knowledge.filter(node => node.parent_id === chapter.id && node.level === 3).map(leaf =>
                <button key={leaf.id} className={`knowledge-chip leaf-chip ${selected.includes(leaf.id) ? 'selected' : ''}`} onClick={() => toggle(leaf.id)}>{leaf.name}</button>
              )}</div>}
            </div>)}</div>
          </div>)}
          {!subjects.length && <div className="empty-state">408 知识树加载失败。</div>}
        </div>}
      </section>
      <section className="panel settings-panel">
        <div className="settings-scroll">
          <div className="section-heading"><span>02</span><div><h2>设定这组练习</h2><p>可混合单选和综合题。</p></div></div>
          <div className="field"><label>组卷模式</label><div className="segmented two">
            <button className={mode === 'exam' ? 'active' : ''} onClick={() => setMode('exam')}>整卷模考<small>跨年份混合</small></button>
            <button className={mode === 'drill' ? 'active' : ''} onClick={() => setMode('drill')}>专项突破<small>同章节集中</small></button>
          </div></div>
          <div className="field"><label>题源</label><div className="source-options">
            <button className={sourceMode === 'real' ? 'active' : ''} onClick={() => setSourceMode('real')}><strong>真题</strong><small>从 408 真题中抽题</small></button>
            <button className={sourceMode === 'ai' ? 'active' : ''} onClick={() => setSourceMode('ai')}><strong>AI 仿真</strong><small>单选盲解，综合题 AI 复核</small></button>
            <button className={sourceMode === 'mixed' ? 'active' : ''} onClick={() => setSourceMode('mixed')}><strong>混合</strong><small>真题与 AI 混合，可含综合题</small></button>
          </div>
          {sourceMode !== 'real' && <div className={`ai-provider-status ${aiConfigured ? 'ok' : ''}`}><span>{aiConfigured ? '模型已配置：单选盲解，综合题 AI 复核' : '尚未配置模型服务，AI 出题不可用'}</span><button onClick={onOpenSettings}>{aiConfigured ? '修改' : '去配置'}</button></div>}
          </div>
          <div className="field"><label>题型与题量 <small>合计 {totalCount} / 30</small></label><div className="type-counts">
            <div className="type-count-row"><span>单项选择题</span><div className="number-input compact"><button onClick={() => setTypeCount('single_choice', typeCounts.single_choice - 1)}>−</button><input type="number" min={0} max={30} value={typeCounts.single_choice} onChange={event => setTypeCount('single_choice', Number(event.target.value))} /><button onClick={() => setTypeCount('single_choice', typeCounts.single_choice + 1)}>+</button></div></div>
            <div className="type-count-row"><span>综合应用题</span><div className="number-input compact"><button  onClick={() => setTypeCount('free_response', typeCounts.free_response - 1)}>−</button><input type="number" min={0} max={30} value={typeCounts.free_response}  onChange={event => setTypeCount('free_response', Number(event.target.value))} /><button  onClick={() => setTypeCount('free_response', typeCounts.free_response + 1)}>+</button></div></div>
          </div></div>
          <div className="field"><label>难度</label><div className="cs408-difficulty-static">按原卷混合<small>逐题难度待模型标注</small></div></div>
          <div className="compose-hint">{selected.length ? '答错的单选会自动进入 408 错题本；综合题不自动判分。' : '请先在左侧选择知识点，才能生成练习卷。'}</div>
        </div>
        <div className="summary">
          <span>{selected.length ? `已选 ${selected.length} 个知识块` : '尚未选择知识点'} · {totalCount} 题</span>
          <button className="primary" disabled={busy || !selected.length || totalCount < 1 || totalCount > 30} onClick={() => onStart(selected, { mode, source_mode: sourceMode, type_counts: typeCounts })}>
            {busy ? '正在组卷…' : '生成 408 练习卷 →'}
          </button>
        </div>
      </section>
    </div>
  </section>;
}
