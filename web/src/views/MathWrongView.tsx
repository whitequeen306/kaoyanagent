import { useMemo, useState } from 'react';
import { MathText } from '../components/MathText';
import { QuestionFigures } from '../components/QuestionFigures';
import { qtypeLabel, wrongPassBucket, wrongRepairGroup } from '../lib/paperMeta';
import type { DailyWrongAnswer } from '../types';

export function MathWrongView({ items, busy, expandedReviews, onToggleReview, onStartRepair, onOpenPaper, onDelete, onCompose }: {
  items: any[];
  busy: boolean;
  expandedReviews: Record<string, boolean>;
  onToggleReview: (questionId: string) => void;
  onStartRepair: (questionId: string) => void;
  onOpenPaper: (paperId: string) => void;
  onDelete: (questionId: string) => void;
  onCompose: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [causeFilter, setCauseFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [passFilter, setPassFilter] = useState('all');
  const [knowledgeFilter, setKnowledgeFilter] = useState('all');

  const groupCounts = useMemo(() => ({
    all: items.length,
    needs_repair: items.filter(item => wrongRepairGroup(item) === 'needs_repair').length,
    repairing: items.filter(item => wrongRepairGroup(item) === 'repairing').length,
    mastered: items.filter(item => wrongRepairGroup(item) === 'mastered').length,
  }), [items]);
  const causes = useMemo(() => [...new Set(items.flatMap(item => item.repair?.diagnosis?.cause_tags || []))], [items]);
  const years = useMemo(() => [...new Set(items.map(item => item.question?.year).filter(Boolean))].sort((a, b) => b - a), [items]);
  const knowledgeNodes = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) for (const node of item.knowledge || []) map.set(node.code, node.name);
    return [...map.entries()].map(([code, name]) => ({ code, name }));
  }, [items]);
  const filtered = useMemo(() => items.filter(item => {
    if (statusFilter !== 'all' && wrongRepairGroup(item) !== statusFilter) return false;
    if (causeFilter !== 'all') {
      const causeTags = item.repair?.diagnosis?.cause_tags || [];
      if (causeFilter === 'none' ? causeTags.length > 0 : !causeTags.includes(causeFilter)) return false;
    }
    if (sourceFilter !== 'all' && item.question?.source !== sourceFilter) return false;
    if (typeFilter !== 'all' && item.question?.qtype !== typeFilter) return false;
    if (yearFilter !== 'all' && item.question?.year !== Number(yearFilter)) return false;
    if (passFilter !== 'all' && wrongPassBucket(item) !== passFilter) return false;
    if (knowledgeFilter !== 'all' && !(item.knowledge || []).some((node: any) => node.code === knowledgeFilter)) return false;
    return true;
  }), [items, statusFilter, causeFilter, sourceFilter, typeFilter, yearFilter, passFilter, knowledgeFilter]);
  const filtersActive = [statusFilter, causeFilter, sourceFilter, typeFilter, yearFilter, passFilter, knowledgeFilter].some(value => value !== 'all');

  return <section className="simple-page"><h1>错题本</h1>
    {items.length > 0 && <div className="filter-bar">
      <div className="filter-tabs">
        <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>全部 <small>{groupCounts.all}</small></button>
        <button className={statusFilter === 'needs_repair' ? 'active' : ''} onClick={() => setStatusFilter('needs_repair')}>待修复 <small>{groupCounts.needs_repair}</small></button>
        <button className={statusFilter === 'repairing' ? 'active' : ''} onClick={() => setStatusFilter('repairing')}>修复中 <small>{groupCounts.repairing}</small></button>
        <button className={statusFilter === 'mastered' ? 'active' : ''} onClick={() => setStatusFilter('mastered')}>已修复 <small>{groupCounts.mastered}</small></button>
      </div>
      <div className="filter-controls">
        <label>错因<select value={causeFilter} onChange={event => setCauseFilter(event.target.value)}><option value="all">全部</option><option value="none">未诊断</option>{causes.map(cause => <option key={cause} value={cause}>{cause}</option>)}</select></label>
        <label>来源<select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="all">全部</option><option value="real">真题</option><option value="ai">AI 原创</option></select></label>
        <label>题型<select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部</option><option value="single_choice">选择题</option><option value="fill_blank">填空题</option><option value="free_response">解答题</option></select></label>
        <label>年份<select value={yearFilter} onChange={event => setYearFilter(event.target.value)}><option value="all">全部</option>{years.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
        <label>修复轮次<select value={passFilter} onChange={event => setPassFilter(event.target.value)}><option value="all">全部</option><option value="0">0 轮</option><option value="1-2">1–2 轮</option><option value="3-4">3–4 轮</option><option value="5">5 轮</option></select></label>
        <label>知识点<select value={knowledgeFilter} onChange={event => setKnowledgeFilter(event.target.value)}><option value="all">全部</option>{knowledgeNodes.map(node => <option key={node.code} value={node.code}>{node.name}</option>)}</select></label>
        {filtersActive && <button className="filter-clear" onClick={() => { setStatusFilter('all'); setCauseFilter('all'); setSourceFilter('all'); setTypeFilter('all'); setYearFilter('all'); setPassFilter('all'); setKnowledgeFilter('all'); }}>清除筛选</button>}
        <span className="filter-result">显示 {filtered.length} / {items.length}</span>
      </div>
    </div>}
    {items.length === 0 ? <div className="empty-card"><h2>暂时没有错题</h2><p>每日一题或试卷里答错的题会出现在这里。</p><button className="primary" onClick={onCompose}>去组一张卷</button></div> : <div className="wrong-list">{filtered.map(item => {
    const question = item.question, review = item.review, attempt = item.attempt;
    const daily: DailyWrongAnswer | null = item.daily_answer;
    const answerRaw = daily ? daily.answer_raw : attempt?.answer_raw;
    const reviewOpen = Boolean(expandedReviews[item.question_id]);
    const hasDetails = Boolean(review?.explanation) || Boolean(review?.solution_steps?.length);
    const repairState = item.repair;
    const repairPasses = repairState?.repair_passes || 0;
    const repairNextAt = repairState?.next_repair_at ? new Date(repairState.next_repair_at) : null;
    return <article className="panel wrong-card" id={`wrong-${item.question_id}`} tabIndex={-1} key={item.question_id}>
      <div className="question-meta">{!daily && <span className="source-tag real">错题 · 修复 {repairPasses}/5 轮</span>}<span className={`source-tag ${question?.source === 'ai' ? 'ai' : 'real'}`}>{question?.source === 'ai' ? 'AI 原创' : `${question?.year || '历年'} 真题 · 第 ${question?.seq_label} 题`}</span><span>{qtypeLabel(question?.qtype)}</span></div>
      <div className="stem"><MathText text={question?.stem_latex || ''} /></div>
      <QuestionFigures assets={question?.figure_assets} />
      {question?.sub_items_json?.map((sub: any) => <div className="sub-item" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
      {question?.qtype === 'single_choice' && question.options_json?.length ? <div className="answer-options">{question.options_json.map((option: any) => {
        const correct = review?.correct_answer?.trim().toUpperCase() === option.label;
        const chosen = answerRaw === option.label;
        return <button key={option.label} disabled className={`${chosen ? 'chosen' : ''} ${correct ? 'correct-option' : chosen ? 'wrong-option' : ''}`}>
          <b>{option.label}</b><MathText text={option.latex} />{correct && <span className="mark correct">✓</span>}{chosen && !correct && <span className="mark wrong">✗</span>}
        </button>;
      })}</div> : null}
      {daily ? <div className="daily-wrong-answer">
        <strong>每日一题 · {daily.date} · {daily.correct ? '回答正确' : '回答错误'}</strong>
        <div>你的作答：{daily.answer_kind === 'image' && '图片已判定'}{daily.answer_raw && <MathText text={daily.answer_raw} />}{daily.answer_kind === 'text' && !daily.answer_raw && '无原文记录'}</div>
        {daily.feedback && <MathText text={daily.feedback} />}
      </div> : question?.qtype !== 'single_choice' && <div className="wrong-answer-line"><strong>你的作答</strong>{attempt?.answer_raw ? <MathText text={attempt.answer_raw} /> : <span>未作答</span>}</div>}
      {review && <div className="answer-review">
        <button type="button" className="correct-answer" onClick={() => onToggleReview(item.question_id)} aria-expanded={reviewOpen}>
          <strong>正确答案</strong>{review.correct_answer ? <MathText text={review.correct_answer} /> : <span>—</span>}
          {hasDetails && <span className="expand-detail">{reviewOpen ? '收起解析 ▲' : '查看解析 ▼'}</span>}
        </button>
        {reviewOpen && <div className="answer-detail">
          {review.explanation && <p><strong>考点解析</strong><MathText text={review.explanation} /></p>}
          {review.solution_steps && review.solution_steps.length > 0 && <ol>{review.solution_steps.map((step: string, index: number) => <li key={index}><MathText text={step} /></li>)}</ol>}
          {!review.explanation && !review.solution_steps?.length && <p className="muted">这道题暂无更多解析。</p>}
        </div>}
      </div>}
      <div className="mastery-box">
        <div className="mastery-row"><strong>修复进度</strong><span>{repairPasses}/5 轮 · {repairState?.repair_variants_done || 0}/15 题</span></div>
        <div className="mastery-bar"><i style={{ width: `${Math.min(100, repairPasses * 20)}%` }} /></div>
        {repairPasses >= 5
          ? <div className="mastered-row"><span>5 轮全部通过，可以移出错题本。</span><button className="mastery-delete" onClick={() => onDelete(item.question_id)} disabled={busy}>移出错题本</button></div>
          : repairNextAt && repairNextAt > new Date()
            ? <p className="muted">本轮已通过，下一轮 {repairNextAt.toLocaleDateString('zh-CN')} 后可再练。</p>
            : null}
      </div>
      <div className="wrong-repair-row">
        <div><strong>AI 修复</strong><span>{repairState?.diagnosis?.summary || '让 AI 诊断这道题的错因，再生成 3 道定向变式。'}</span></div>
        {repairState?.status === 'ready' && repairState.paper_id
          ? <button className="primary small" disabled={busy} onClick={() => onOpenPaper(repairState.paper_id)}>打开修复卷 →</button>
          : repairState?.status === 'generating'
            ? <button className="primary small" disabled>AI 生成中…</button>
            : repairNextAt && repairNextAt > new Date()
              ? <button className="primary small" disabled>下一轮待复习</button>
              : <button className="primary small" disabled={busy || repairPasses >= 5} onClick={() => onStartRepair(item.question_id)}>{repairPasses ? '开始下一轮 →' : '让 AI 修复 →'}</button>}
      </div>
      <p className="muted">下次复习：{new Date(item.next_review_at).toLocaleDateString('zh-CN')}</p>
    </article>;
  })}{!filtered.length && <div className="filter-empty">没有符合当前筛选的错题。</div>}</div>}
  </section>;
}
