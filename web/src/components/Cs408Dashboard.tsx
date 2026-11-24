import type { Cs408Metrics } from '../types';

export function Cs408Dashboard({ metrics, loading, onOpen, onRefresh }: {
  metrics: Cs408Metrics | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}) {
  if (loading && !metrics) return <section className="simple-page cs408-page"><div className="empty-card"><h2>正在读取 408 数据…</h2></div></section>;
  if (!metrics) return <section className="simple-page cs408-page"><div className="empty-card"><h2>408 数据暂不可用</h2><button className="primary" onClick={onRefresh}>重试</button></div></section>;
  return <section className="simple-page cs408-page">
    <span className="eyebrow">408 · 学习数据</span>
    <h1>数据中心</h1>
    <p>汇总 408 题库、试卷、单选作答和章节薄弱点。只统计这台设备的匿名记录。</p>
    <div className="metric-grid">
      <div className="metric-card"><span>408 题库</span><strong>{metrics.question_bank}</strong><small>道已发布真题</small></div>
      <div className="metric-card"><span>已交卷</span><strong>{metrics.submitted}</strong><small>共 {metrics.papers} 张 408 试卷</small></div>
      <div className="metric-card"><span>真题年份</span><strong>{metrics.exam_years_done} / 18</strong><small>已交卷的整卷年份</small></div>
      <div className="metric-card"><span>单选得分率</span><strong>{metrics.score_rate_bp == null ? '—' : `${Math.round(metrics.score_rate_bp / 100)}%`}</strong><small>{metrics.single_attempts} 次单选作答</small></div>
      <div className="metric-card"><span>未掌握错题</span><strong>{metrics.wrong_count}</strong><small>408 错题本条目</small></div>
      <div className="metric-card"><span>专项 / 修复</span><strong>{metrics.practice_papers} / {metrics.repair_papers}</strong><small>练习卷 / AI 修复卷</small></div>
    </div>
    <div className="panel cs408-chapter-panel">
      <div className="cs408-panel-head"><h2>章节薄弱点</h2><button onClick={onRefresh} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button></div>
      {metrics.chapters.length ? <div className="cs408-chapter-list">{metrics.chapters.map(chapter => <div className="cs408-chapter-row" key={chapter.code}>
        <div><strong>{chapter.name}</strong><span>{chapter.correct} / {chapter.attempts} 题正确</span></div>
        <div className="cs408-chapter-bar"><i style={{ width: `${Math.max(4, Math.round((chapter.score_rate_bp || 0) / 100))}%` }} /></div>
        <b>{chapter.score_rate_bp == null ? '—' : `${Math.round(chapter.score_rate_bp / 100)}%`}</b>
      </div>)}</div> : <div className="empty-state">还没有足够的 408 单选作答，先做一套真题或专项练习。</div>}
    </div>
    <div className="panel cs408-recent-panel">
      <div className="cs408-panel-head"><h2>最近 408 试卷</h2><span>{metrics.recent.length} 张</span></div>
      {metrics.recent.length ? <div className="cs408-recent-list">{metrics.recent.map(item => <button className="cs408-recent-row" key={item.id} onClick={() => onOpen(item.id)}>
        <span>{item.title}</span>
        <small>{new Date(item.created_at).toLocaleDateString('zh-CN')} · {item.questions} 题</small>
        <b>{item.status === 'submitted' && item.score_x2 != null ? `${Math.round((item.score_rate_bp || 0) / 100)}%` : '待完成'}</b>
      </button>)}</div> : <div className="empty-state">还没有 408 试卷记录。</div>}
    </div>
  </section>;
}
