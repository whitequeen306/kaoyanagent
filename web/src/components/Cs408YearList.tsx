import { formatScore } from '../lib/api';
import type { Cs408Year } from '../types';

export function Cs408YearList({ years, loading, busy, onOpen }: {
  years: Cs408Year[];
  loading: boolean;
  busy: boolean;
  onOpen: (year: number, restart?: boolean) => void;
}) {
  const submitted = years.filter(item => item.status === 'submitted').length;
  return <section className="simple-page cs408-page">
    <span className="eyebrow">408 · 计算机学科专业基础综合</span>
    <h1>历年真题整卷</h1>
    <p>按年份练完整试卷。40 道单选交卷后自动判分，7 道综合题对照解析自评；错题自动进入 408 错题本。</p>
    <div className="cs408-summary-strip">
      <div><strong>{years.length}</strong><span>年真题</span></div>
      <div><strong>{years.length * 47}</strong><span>道题</span></div>
      <div><strong>{submitted}</strong><span>套已交卷</span></div>
      <div><strong>80</strong><span>单选自动判分</span></div>
    </div>
    {loading && !years.length ? <div className="empty-card"><h2>正在加载真题…</h2><p>读取 2009—2026 年试卷目录。</p></div> : <div className="cs408-year-grid">
      {years.slice().sort((a, b) => b.year - a.year).map(item => {
        const status = item.status === 'submitted' ? '已交卷' : item.status === 'draft' ? '待完成' : '未开始';
        return <article className={`panel cs408-year-card ${item.status || ''}`} key={item.year}>
          <div className="cs408-year-top">
            <span className="cs408-year-number">{item.year}</span>
            <span className={`source-tag ${item.status === 'submitted' ? 'real' : 'fixture'}`}>{status}</span>
          </div>
          <h2>{item.year} 年 408 真题</h2>
          <p>{item.single_choice} 单选 · {item.free_response} 综合 · 150 分</p>
          {item.status === 'submitted' && item.score_x2 != null && <div className="cs408-year-score">
            <strong>{formatScore(item.score_x2)} / {formatScore(item.max_score_x2)}</strong>
            <span>单选得分 · {item.score_rate_bp == null ? '—' : `${Math.round(item.score_rate_bp / 100)}%`}</span>
          </div>}
          <div className="cs408-year-actions">
            <button className="primary small" disabled={busy} onClick={() => onOpen(item.year)}>
              {item.status === 'submitted' ? '查看解析 →' : item.status === 'draft' ? '继续作答 →' : '开始练习 →'}
            </button>
            {item.status === 'submitted' && <button className="cs408-restart" disabled={busy} onClick={() => onOpen(item.year, true)}>重新练习</button>}
          </div>
          {item.year === 2026 && <p className="cs408-source-note">2026 为公开回忆整理版。</p>}
        </article>;
      })}
    </div>}
  </section>;
}
