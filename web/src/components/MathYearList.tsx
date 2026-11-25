import { formatScore } from '../lib/api';
import type { MathExamYear } from '../types';

export function MathYearList({ years, loading, busy, onOpen }: {
  years: MathExamYear[];
  loading: boolean;
  busy: boolean;
  onOpen: (year: number, restart?: boolean) => void;
}) {
  const answeredFor = (item: MathExamYear) => {
    if (item.status === 'submitted') return item.answered_questions || 0;
    if (!item.paper_id) return 0;
    try {
      const saved = localStorage.getItem(`kaoyan-answers-${item.paper_id}`);
      const map = saved ? JSON.parse(saved) as Record<string, string> : {};
      return Object.values(map).filter(value => typeof value === 'string' && value.trim()).length;
    } catch { return 0; }
  };
  const workedYears = years.filter(item => answeredFor(item) > 0).length;
  const workedQuestions = years.reduce((sum, item) => sum + answeredFor(item), 0);
  return <section className="simple-page cs408-page">
    <span className="eyebrow">数学二 · 历年真题</span>
    <h1>真题试卷</h1>
    <p>按年份练考研数学二整卷。选择题和填空题交卷自动判分，解答题进入 rubric 待复核；错题自动进入错题本并参与今日修复。</p>
    <div className="cs408-summary-strip">
      <div><strong>{years.length}</strong><span>年真题</span></div>
      <div><strong>{years.reduce((sum, item) => sum + item.question_count, 0)}</strong><span>道题</span></div>
      <div><strong>{workedYears}</strong><span>年已做</span></div>
      <div><strong>{workedQuestions}</strong><span>题已做</span></div>
    </div>
    {loading && !years.length ? <div className="empty-card"><h2>正在加载数学真题…</h2><p>读取 2005—2026 年试卷目录。</p></div> : <div className="cs408-year-grid">
      {years.slice().sort((a, b) => b.year - a.year).map(item => {
        const status = item.status === 'submitted' ? '已交卷' : item.status === 'draft' ? '待完成' : '未开始';
        return <article className={`panel cs408-year-card ${item.status || ''}`} key={item.year}>
          <div className="cs408-year-top">
            <span className="cs408-year-number">{item.year}</span>
            <span className={`source-tag ${item.status === 'submitted' ? 'real' : 'fixture'}`}>{status}</span>
          </div>
          <h2>{item.year} 年考研数学二</h2>
          <p>{item.single_choice} 选择 · {item.fill_blank} 填空 · {item.free_response} 解答 · {formatScore(item.total_score_x2)} 分</p>
          {item.held_count > 0 && <p className="cs408-source-note">含 {item.held_count} 道题源缺图题，已保留题干。</p>}
          {item.status === 'submitted' && item.score_x2 != null && <div className="cs408-year-score">
            <strong>{formatScore(item.score_x2)} / {formatScore(item.max_score_x2)}</strong>
            <span>得分 · {item.score_rate_bp == null ? '—' : `${Math.round(item.score_rate_bp / 100)}%`}</span>
          </div>}
          <div className="cs408-year-actions">
            <button className="primary small" disabled={busy} onClick={() => onOpen(item.year)}>
              {item.status === 'submitted' ? '查看解析 →' : item.status === 'draft' ? '继续作答 →' : '开始练习 →'}
            </button>
            {item.status === 'submitted' && <button className="cs408-restart" disabled={busy} onClick={() => onOpen(item.year, true)}>重新练习</button>}
          </div>
        </article>;
      })}
    </div>}
  </section>;
}
