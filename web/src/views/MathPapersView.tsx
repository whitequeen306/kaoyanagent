import { useMemo, useState } from 'react';
import { formatScore } from '../lib/api';
import { paperOriginKey, paperOriginLabel, sourceLabel } from '../lib/paperMeta';

export function MathPapersView({ papers, onOpen, onOpenPdf, onDraftPdf, onCompose }: {
  papers: any[];
  onOpen: (paperId: string) => void;
  onOpenPdf: (paperId: string) => void;
  onDraftPdf: (summary: any) => void;
  onCompose: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [originFilter, setOriginFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('all');

  const years = useMemo(() => [...new Set(papers.flatMap(paper => paper.years || []))].sort((a, b) => b - a), [papers]);
  const statusCounts = useMemo(() => ({
    all: papers.length,
    draft: papers.filter(paper => paper.status !== 'submitted').length,
    submitted: papers.filter(paper => paper.status === 'submitted').length,
  }), [papers]);
  const filtered = useMemo(() => papers.filter(paper => {
    if (statusFilter !== 'all' && (statusFilter === 'submitted' ? paper.status !== 'submitted' : paper.status === 'submitted')) return false;
    if (originFilter !== 'all' && paperOriginKey(paper) !== originFilter) return false;
    if (modeFilter !== 'all' && paper.mode !== modeFilter) return false;
    if (sourceFilter !== 'all' && paper.source_mode !== sourceFilter) return false;
    if (yearFilter !== 'all' && !(paper.years || []).includes(Number(yearFilter))) return false;
    if (timeFilter !== 'all') {
      const days = (Date.now() - new Date(paper.created_at).getTime()) / 86400000;
      if (timeFilter === '7' && days > 7) return false;
      if (timeFilter === '30' && days > 30) return false;
      if (timeFilter === 'older' && days <= 30) return false;
    }
    return true;
  }), [papers, statusFilter, originFilter, modeFilter, sourceFilter, yearFilter, timeFilter]);
  const filtersActive = [statusFilter, originFilter, modeFilter, sourceFilter, yearFilter, timeFilter].some(value => value !== 'all');

  return <section className="simple-page">
    <span className="eyebrow">你的组卷与作答记录</span><h1>我的试卷</h1>
    <p>点击试卷继续作答；需要留档时点「保存为 PDF」。未交卷保存空白卷，已交卷可选择带解析或空白卷。</p>
    <div className="filter-bar">
      <div className="filter-tabs">
        <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>全部 <small>{statusCounts.all}</small></button>
        <button className={statusFilter === 'draft' ? 'active' : ''} onClick={() => setStatusFilter('draft')}>待完成 <small>{statusCounts.draft}</small></button>
        <button className={statusFilter === 'submitted' ? 'active' : ''} onClick={() => setStatusFilter('submitted')}>已交卷 <small>{statusCounts.submitted}</small></button>
      </div>
      <div className="filter-controls">
        <label>类型<select value={originFilter} onChange={event => setOriginFilter(event.target.value)}><option value="all">全部</option><option value="free">自由练习</option><option value="exam">真题整卷</option><option value="repair">错题修复</option><option value="variant">错题仿真</option></select></label>
        <label>模式<select value={modeFilter} onChange={event => setModeFilter(event.target.value)}><option value="all">全部</option><option value="exam">整卷模考</option><option value="drill">专项突破</option></select></label>
        <label>题源<select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="all">全部</option><option value="real">真题</option><option value="ai">AI 仿真</option><option value="mixed">混合</option></select></label>
        <label>年份<select value={yearFilter} onChange={event => setYearFilter(event.target.value)}><option value="all">全部</option>{years.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
        <label>时间<select value={timeFilter} onChange={event => setTimeFilter(event.target.value)}><option value="all">全部</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="older">更早</option></select></label>
        {filtersActive && <button className="filter-clear" onClick={() => { setStatusFilter('all'); setOriginFilter('all'); setModeFilter('all'); setSourceFilter('all'); setYearFilter('all'); setTimeFilter('all'); }}>清除筛选</button>}
        <span className="filter-result">显示 {filtered.length} / {papers.length}</span>
      </div>
    </div>
    {papers.length === 0 ? <div className="empty-card"><h2>还没有组卷记录</h2><p>生成第一张试卷后，这里会保存你的待做与已完成记录。</p><button className="primary" onClick={onCompose}>去组一张卷</button></div> : <div className="paper-history">
      {filtered.map(paper => <article className="paper-history-item panel" key={paper.id}>
        <button className="paper-history-main" onClick={() => onOpen(paper.id)}>
          <div className="paper-history-top">
            <span className={`source-tag ${paper.status === 'submitted' ? 'real' : 'fixture'}`}>{paper.status === 'submitted' ? '已交卷' : '待完成'}</span>
            <span className="source-tag">{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</span>
            <span className={`source-tag ${paperOriginKey(paper) !== 'free' ? 'ai' : ''}`}>{paperOriginLabel(paper)}</span><span className={`source-tag ${paper.source_mode === 'real' ? 'real' : ''}`}>{sourceLabel(paper.source_mode)}</span>
            <span className="paper-history-date">{new Date(paper.created_at).toLocaleString('zh-CN')}</span>
          </div>
          <h2>{paper.title}</h2>
          <p>{paper.questions} 题 · 卷面 {formatScore(paper.total_score_x2)} 分{paper.status === 'submitted' && paper.grading_pending ? ' · 解答题 AI 批改中…' : paper.status === 'submitted' && paper.score_x2 != null ? ` · 得分 ${formatScore(paper.score_x2)} / ${formatScore(paper.max_score_x2)} · 得分率 ${paper.score_rate_bp / 100}%` : ' · 继续作答'}</p>
        </button>
        <div className="paper-history-actions">
          <button className="paper-history-open" onClick={() => onOpen(paper.id)}>{paper.status === 'submitted' ? '查看解析 →' : '继续作答 →'}</button>
          <button className="paper-pdf-button" onClick={() => paper.status === 'submitted' ? onOpenPdf(paper.id) : onDraftPdf(paper)}>保存为 PDF</button>
        </div>
      </article>)}
      {!filtered.length && <div className="filter-empty">没有符合当前筛选的试卷。</div>}
    </div>}</section>;
}
