import { useMemo, useState } from 'react';
import { DailyQuestionCard } from '../components/DailyQuestionCard';
import { difficultyLabel } from '../lib/api';
import { qtypeOptions, sourceOptions } from '../lib/paperMeta';
import type { DailyAnswerImage, DailyQuestionState, Difficulty, Knowledge, PaperMode, Qtype, SourceMode } from '../types';

export function MathComposeView({ knowledge, selected, mode, source, difficulty, typeCounts, totalCount, mixedRealCount, mixedAiCount, busy, aiSettings, openSettings, daily, onToggleKnowledge, onMode, onSource, onDifficulty, onTypeCount, onCompose, onDailyWrong }: {
  knowledge: Knowledge[];
  selected: string[];
  mode: PaperMode;
  source: SourceMode;
  difficulty: Difficulty;
  typeCounts: Record<Qtype, number>;
  totalCount: number;
  mixedRealCount: number;
  mixedAiCount: number;
  busy: boolean;
  aiSettings: any;
  openSettings: () => void;
  daily: {
    question: DailyQuestionState | null;
    answer: string;
    answerImage: DailyAnswerImage | null;
    busy: boolean;
    reading: boolean;
    error: string;
    aiBusy: boolean;
    aiPrompt: string;
    onAnswerChange: (value: string) => void;
    onImageSelect: (file: File) => void;
    onImageRemove: () => void;
    onSubmit: () => void;
    onAiPromptChange: (value: string) => void;
    onAiAsk: (prompt: string) => void;
  };
  onToggleKnowledge: (id: string) => void;
  onMode: (mode: PaperMode) => void;
  onSource: (source: SourceMode) => void;
  onDifficulty: (difficulty: Difficulty) => void;
  onTypeCount: (type: Qtype, value: number) => void;
  onCompose: () => void;
  onDailyWrong: (questionId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const subjects = knowledge.filter(node => node.level === 1);
  const searchResults = useMemo(() => query ? knowledge.filter(node => node.name.includes(query) || node.aliases.some(alias => alias.includes(query))) : [], [knowledge, query]);
  const toggleExpanded = (id: string) => setExpanded(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);

  return <>
    <section className="intro no-print">
      <h1>自由练习组卷</h1>
      <p>想额外刷题时，再按知识点自由组卷；错题会自动进入「今日修复」。</p>
    </section>
    {daily.question && <DailyQuestionCard
      daily={daily.question}
      answer={daily.answer}
      answerImage={daily.answerImage}
      busy={daily.busy}
      reading={daily.reading}
      error={daily.error}
      modelConfigured={Boolean(aiSettings?.configured)}
      onSettings={openSettings}
      onWrong={() => onDailyWrong(daily.question!.question.id)}
      aiBusy={daily.aiBusy}
      aiPrompt={daily.aiPrompt}
      onAnswerChange={daily.onAnswerChange}
      onImageSelect={daily.onImageSelect}
      onImageRemove={daily.onImageRemove}
      onSubmit={daily.onSubmit}
      onAiPromptChange={daily.onAiPromptChange}
      onAiAsk={daily.onAiAsk}
    />}
    <div className="compose-layout no-print">
      <section className="panel knowledge-panel">
        <div className="section-heading"><span>01</span><div><h2>选择知识点</h2><p>支持多选，选择章节会包含其下全部考点。</p></div></div>
        <label className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="试试：极限、二重积分、微分方程" /></label>
        {query ? <div className="knowledge-grid search-live">{searchResults.map(node => <button key={node.id} className={`knowledge-chip ${selected.includes(node.id) ? 'selected' : ''}`} onClick={() => onToggleKnowledge(node.id)}>
          <span className="chip-dot" />{node.name}<small>{node.level === 1 ? '整门' : node.level === 2 ? '章节' : '考点'}</small>
        </button>)}{!searchResults.length && <div className="empty-state">没有匹配的知识点</div>}</div> : <div className="knowledge-tree">{subjects.map(subject => <div className="tree-subject" key={subject.id}>
          <button className={`knowledge-chip subject-chip ${selected.includes(subject.id) ? 'selected' : ''}`} onClick={() => onToggleKnowledge(subject.id)}><span className="chip-dot" />{subject.name}<small>整门</small></button>
          <div className="tree-chapters">{knowledge.filter(node => node.parent_id === subject.id && node.level === 2).map(chapter => <div className="chapter-block" key={chapter.id}>
            <button className={`knowledge-chip chapter-chip ${selected.includes(chapter.id) ? 'selected' : ''}`} onClick={() => { onToggleKnowledge(chapter.id); toggleExpanded(chapter.id); }}>
              <span className="chip-dot" />{chapter.name}<span className="expand-mark">{expanded.includes(chapter.id) ? '−' : '+'}</span>
            </button>
            {expanded.includes(chapter.id) && <div className="leaf-list">{knowledge.filter(node => node.parent_id === chapter.id && node.level === 3).map(leaf =>
              <button key={leaf.id} className={`knowledge-chip leaf-chip ${selected.includes(leaf.id) ? 'selected' : ''}`} onClick={() => onToggleKnowledge(leaf.id)}>{leaf.name}</button>)}
            </div>}
          </div>)}</div>
        </div>)}</div>}
        {!knowledge.length && <div className="empty-state">正在加载知识点…</div>}
      </section>
      <section className="panel settings-panel">
        <div className="settings-scroll">
        <div className="section-heading"><span>02</span><div><h2>设定这张卷</h2><p>你可以随时调整。</p></div></div>
        <div className="field"><label>组卷模式</label><div className="segmented two"><button className={mode === 'exam' ? 'active' : ''} onClick={() => onMode('exam')}>整卷模考<small>易 → 中 → 难梯度</small></button><button className={mode === 'drill' ? 'active' : ''} onClick={() => onMode('drill')}>专项突破<small>同档集中练习</small></button></div></div>
        <div className="field"><label>题源</label><div className="source-options">{sourceOptions.map(item => <button key={item.value} className={source === item.value ? 'active' : ''} onClick={() => onSource(item.value)}><strong>{item.label}</strong><small>{item.value === 'real' ? item.note : item.value === 'mixed' ? `真题与 AI 各半，奇数时真题多 1 道（本卷 ${mixedRealCount} + ${mixedAiCount}）` : '后台生成约 10–60 秒，完成后右下角通知'}</small></button>)}</div></div>
        {source !== 'real' && <div className={`ai-provider-status ${aiSettings?.configured ? 'ok' : ''}`}><span>{aiSettings?.configured ? `模型：${aiSettings.model}` : '尚未配置模型服务，AI 出卷不可用'}</span><button onClick={openSettings}>{aiSettings?.configured ? '修改' : '去配置'}</button></div>}
        <div className="field"><label>题型与题量 <small>合计 {totalCount} / 30</small></label><div className="type-counts">{qtypeOptions.map(item => <div className="type-count-row" key={item.value}><span>{item.label}</span><div className="number-input compact"><button onClick={() => onTypeCount(item.value, typeCounts[item.value] - 1)}>−</button><input type="number" min={0} max={30} value={typeCounts[item.value]} onChange={e => onTypeCount(item.value, Number(e.target.value))} /><button onClick={() => onTypeCount(item.value, typeCounts[item.value] + 1)}>+</button></div></div>)}</div>{totalCount > 30 && <div className="field-error">题量合计不能超过 30。</div>}</div>
        <div className="field"><label>难度</label><div className="difficulty-row">{(['easy', 'medium', 'hard'] as Difficulty[]).map(value => <button key={value} className={difficulty === value ? 'active' : ''} onClick={() => onDifficulty(value)}>{difficultyLabel(value)}</button>)}</div></div>
        {!selected.length && <div className="compose-hint">请先在左侧选择知识点，才能生成试卷。</div>}
        </div>
        <div className="summary"><span>{selected.length ? `已选 ${selected.length} 个知识块` : '尚未选择知识点'} · {totalCount} 题</span><button className="primary" disabled={busy || !selected.length || totalCount < 1 || totalCount > 30} onClick={onCompose}>{busy ? (source === 'real' ? '正在组卷…' : '正在加入队列…') : source === 'real' ? '生成试卷 →' : '加入出卷队列 →'}</button></div>
      </section>
    </div>
  </>;
}
