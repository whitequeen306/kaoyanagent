import { useMemo, useState } from 'react';
import { formatScore } from '../lib/api';
import type { Cs408HistoryItem } from '../types';

const originLabel = (origin: string | null) => origin === 'cs408_exam' ? '真题整卷' : origin === 'cs408_practice' ? '专项练习' : origin === 'repair' ? 'AI 修复' : '408 试卷';

export function Cs408History({ items, loading, onOpen, onPractice }: {
  items: Cs408HistoryItem[];
  loading: boolean;
  onOpen: (id: string) => void;
  onPractice: () => void;
}) {
  const [status, setStatus] = useState('all');
  const [origin, setOrigin] = useState('all');
  const filtered = useMemo(() => items.filter(item => {
    if (status === 'draft' && item.status === 'submitted') return false;
    if (status === 'submitted' && item.status !== 'submitted') return false;
    if (origin !== 'all' && item.origin !== origin) return false;
    return true;
  }), [items, status, origin]);
  const submitted = items.filter(item => item.status === 'submitted').length;
  return <section className="simple-page cs408-page">
    <span className="eyebrow">408 · 你的练习记录</span>
    <h1>我的试卷</h1>
    <p>408 真题、专项练习和 AI 修复卷都在这里。交卷后可以回看题目、正确答案和解析。</p>
    <div className="filter-bar">
      <div className="filter-tabs">
        <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>全部 <small>{items.length}</small></button>
        <button className={status === 'draft' ? 'active' : ''} onClick={() => setStatus('draft')}>待完成 <small>{items.length - submitted}</small></button>
        <button className={status === 'submitted' ? 'active' : ''} onClick={() => setStatus('submitted')}>已交卷 <small>{submitted}</small></button>
      </div>
      <div className="filter-controls">
        <label>类型<select value={origin} onChange={event => setOrigin(event.target.value)}><option value="all">全部</option><option value="cs408_exam">真题整卷</option><option value="cs408_practice">专项练习</option><option value="repair">AI 修复</option></select></label>
        {(status !== 'all' || origin !== 'all') && <button className="filter-clear" onClick={() => { setStatus('all'); setOrigin('all'); }}>清除筛选</button>}
        <span className="filter-result">显示 {filtered.length} / {items.length}</span>
      </div>
    </div>
    {loading && !items.length ? <div className="empty-card"><h2>正在加载 408 试卷…</h2></div> : !items.length
      ? <div className="empty-card"><h2>还没有 408 试卷</h2><p>做一套真题或按章节组一组练习，记录会保存在这里。</p><button className="primary" onClick={onPractice}>去自由练习</button></div>
      : <div className="paper-history">{filtered.map(item => <article className="paper-history-item panel" key={item.id}>
        <button className="paper-history-main" onClick={() => onOpen(item.id)}>
          <div className="paper-history-top">
            <span className={`source-tag ${item.status === 'submitted' ? 'real' : 'fixture'}`}>{item.status === 'submitted' ? '已交卷' : '待完成'}</span>
            <span className={`source-tag ${item.origin === 'repair' ? 'ai' : ''}`}>{originLabel(item.origin)}</span>
            {item.year && <span className="source-tag">{item.year}</span>}
            <span className="paper-history-date">{new Date(item.created_at).toLocaleString('zh-CN')}</span>
          </div>
          <h2>{item.title}</h2>
          <p>{item.questions} 题{item.status === 'submitted' && item.score_x2 != null ? ` · 单选得分 ${formatScore(item.score_x2)} / ${formatScore(item.max_score_x2)} · 得分率 ${Math.round((item.score_rate_bp || 0) / 100)}%` : ' · 继续作答'}</p>
        </button>
        <div className="paper-history-actions"><button className="paper-history-open" onClick={() => onOpen(item.id)}>{item.status === 'submitted' ? '查看解析 →' : '继续作答 →'}</button></div>
      </article>)}{!filtered.length && <div className="filter-empty">没有符合当前筛选的 408 试卷。</div>}</div>}
  </section>;
}
