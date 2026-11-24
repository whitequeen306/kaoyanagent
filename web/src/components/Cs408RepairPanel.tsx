import { Cs408Html } from './Cs408Html';
import type { Cs408RepairCase } from '../types';

const statusText: Record<string, string> = {
  new: '待诊断', generating: 'AI 正在修复', ready: '修复卷已就绪', needs_retry: '还需要再练',
  passed: '本轮通过', completed: '已修复', failed: '生成失败',
};

function sourceLabel(item: Cs408RepairCase) {
  const question = item.question;
  if (!question) return '408 错题';
  if (question.source === 'ai' || !question.year) return 'AI 同考点变式';
  return `${question.year} 真题 · 第 ${question.number} 题`;
}

export function Cs408RepairPanel({ cases, loading, busy, date, backlogCount, completedCount, aiConfigured, onOpenSettings, onStart, onOpenPaper, onRefresh, onOpenPractice, onOpenWrong }: {
  cases: Cs408RepairCase[];
  loading: boolean;
  busy: boolean;
  date: string;
  backlogCount: number;
  completedCount: number;
  aiConfigured: boolean;
  onOpenSettings: () => void;
  onStart: (item: Cs408RepairCase) => void;
  onOpenPaper: (item: Cs408RepairCase) => void;
  onRefresh: () => void;
  onOpenPractice: () => void;
  onOpenWrong: () => void;
}) {
  return <section className="repair-page cs408-repair-page">
    <div className="intro repair-intro">
      <span className="eyebrow">408 · AI 错因修复</span>
      <h1>今日修复</h1>
      <p>每天从 408 错题本抽 4 道单选。AI 先诊断错因，再生成 3 道同章节变式；全部答对算一轮通过，5 轮后掌握。</p>
    </div>
    <div className="repair-overview">
      <div><strong>{cases.length}</strong><span>道今日修复</span></div>
      <div><strong>{completedCount}</strong><span>道已修复</span></div>
      <div className="repair-overview-note">抽题固定到 {date || '今天'} · 错题本共 {backlogCount} 道未掌握</div>
      <button onClick={onOpenWrong}>去 408 错题本</button>
      <button onClick={onRefresh} disabled={loading || busy}>{loading ? '刷新中…' : '刷新'}</button>
    </div>
    {!aiConfigured && <div className="repair-notice"><span>AI 诊断和变式生成需要模型服务。</span><button onClick={onOpenSettings}>去配置模型</button></div>}
    {!cases.length && <div className="panel repair-empty">
      <span className="eyebrow">从第一道 408 错题开始</span>
      <h2>还没有待修复的 408 错题</h2>
      <p>做一张 408 真题或专项练习，答错的单选会自动进入错题本，并有机会进入今日修复。</p>
      <button className="primary" onClick={onOpenPractice}>去做 408 练习</button>
    </div>}
    {!!cases.length && <div className="repair-list">{cases.map(item => <article className={`panel repair-card repair-${item.status}`} key={item.id}>
      <div className="repair-card-head">
        <div className="repair-card-meta">
          <span className="source-tag real">{sourceLabel(item)}</span>
          <span className={`repair-status ${item.status}`}>{statusText[item.status] || item.status}</span>
        </div>
        <span className="repair-case-index">{item.repair_passes || 0}/5 轮 · {item.repair_variants_done || 0}/15 题</span>
      </div>
      <div className="repair-round-bar"><i style={{ width: `${Math.min(100, ((item.repair_passes || 0) / 5) * 100)}%` }} /></div>
      {item.question && <div className="repair-question cs408-repair-question">
        <Cs408Html html={item.question.question_html} />
      </div>}
      {item.knowledge.length > 0 && <div className="repair-tags cs408-repair-tags">{item.knowledge.map(node => <span key={node.code}>{node.name}</span>)}</div>}
      {item.diagnosis ? <div className="repair-diagnosis">
        <div className="repair-diagnosis-head"><strong>AI 诊断</strong><span>{item.diagnosis.confidence ? `置信度 ${item.diagnosis.confidence}%` : '待补充证据'}</span></div>
        <p>{item.diagnosis.summary}</p>
        {item.diagnosis.first_gap && <p className="muted">首个缺口：{item.diagnosis.first_gap}</p>}
        <div className="repair-tags">{item.diagnosis.cause_tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        {item.wrong_answer && <p className="repair-wrong-answer">你的答案：{item.wrong_answer}</p>}
      </div> : <div className="repair-diagnosis repair-diagnosis-pending">
        <strong>{item.status === 'generating' ? 'AI 正在诊断错因…' : '先让 AI 看懂这道 408 错题'}</strong>
        <p>会结合你的错误答案、原题和章节，定位第一个实质错误，再生成 3 道针对性的同章节变式。</p>
        {item.job_detail && <small>{item.job_detail}</small>}
        {item.job_progress != null && item.status === 'generating' && <div className="repair-progress"><i style={{ width: `${item.job_progress}%` }} /></div>}
      </div>}
      <div className="repair-actions">
        {item.status === 'generating' ? <span className="repair-action-note">{item.job_stage || '正在生成'} · {item.job_progress ?? 0}%</span>
          : item.status === 'ready' ? <button className="primary" onClick={() => onOpenPaper(item)}>打开修复卷 →</button>
          : item.status === 'needs_retry' ? <button className="primary" onClick={() => onStart(item)} disabled={busy}>继续生成变式 →</button>
          : item.status === 'passed' ? (item.next_repair_at && new Date(item.next_repair_at) > new Date()
            ? <span className="repair-action-note">本轮通过 · 下一轮 {new Date(item.next_repair_at).toLocaleDateString('zh-CN')} 后可再来</span>
            : <button className="primary" onClick={() => onStart(item)} disabled={busy}>开始下一轮 →</button>)
          : <button className="primary" onClick={() => onStart(item)} disabled={busy}>{item.status === 'failed' ? '重新生成变式 →' : '生成 3 道变式 →'}</button>}
      </div>
    </article>)}</div>}
  </section>;
}
