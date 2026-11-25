import { sourceLabel } from '../lib/paperMeta';

export function MathMetricsView({ metrics, trends, onOpenRecent }: {
  metrics: any;
  trends: any[];
  onOpenRecent: (paperId: string) => void;
}) {
  return <section className="simple-page">
    <span className="eyebrow">公开、可复核的质量数据</span><h1>数据中心</h1>
    <p>展示聚合指标与近期组卷，不包含任何用户作答内容或设备标识。组卷记录可点击查看公开预览。</p>
    <div className="metric-grid">
      <div className="metric-card"><span>题库题目</span><strong>{metrics?.question_bank?.real + metrics?.question_bank?.ai || 0}</strong><small>真题 {metrics?.question_bank?.real || 0} / AI {metrics?.question_bank?.ai || 0}</small></div>
      <div className="metric-card"><span>组卷成功</span><strong>{metrics?.compose?.success ?? 0}</strong><small>失败 {metrics?.compose?.failure ?? 0} 次</small></div>
      <div className="metric-card"><span>组卷成功率</span><strong>{metrics?.compose?.success_rate == null ? '—' : `${metrics.compose.success_rate}%`}</strong><small>成功 /（成功 + 失败）</small></div>
      <div className="metric-card"><span>错题条目</span><strong>{metrics?.wrong_book_entries ?? '—'}</strong><small>匿名分桶</small></div>
    </div>
    <div className="panel recent-panel"><h2>近期组卷（任意用户，最近 8 张）</h2>
      {metrics?.recent_papers?.length ? <table className="recent-table"><thead><tr><th>时间</th><th>模式</th><th>题源</th><th>知识点</th><th>题量</th><th>卷面</th><th>年份</th><th>操作</th></tr></thead><tbody>{metrics.recent_papers.map((paper: any) => <tr key={paper.id} className="recent-row" onClick={() => onOpenRecent(paper.id)}><td>{new Date(paper.created_at).toLocaleString('zh-CN')}</td><td>{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</td><td>{sourceLabel(paper.source_mode)}</td><td>{paper.title || '综合练习'}</td><td>{paper.questions}</td><td>{paper.total_points} 分</td><td>{paper.years?.join('、') || '—'}</td><td><button className="recent-open" onClick={event => { event.stopPropagation(); onOpenRecent(paper.id); }}>查看</button></td></tr>)}</tbody></table> : <div className="empty-state">还没有组卷记录。</div>}
    </div>
    <div className="panel trend-panel"><h2>作答趋势</h2>{trends.length ? trends.map(item => <div className="trend-row" key={item.date}><span>{item.date}</span><div><i style={{ width: `${Math.min(100, item.attempts * 12)}%` }} /></div><strong>{item.attempts}</strong></div>) : <div className="empty-state">数据积累中，趋势图将在产生作答后展示。</div>}</div>
  </section>;
}
