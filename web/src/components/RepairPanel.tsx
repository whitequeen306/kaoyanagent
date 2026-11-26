import { MathText } from './MathText';
import { QuestionFigures } from './QuestionFigures';
import type { RepairCase } from '../types';

type RepairPanelProps = {
  cases: RepairCase[];
  loading: boolean;
  busy: boolean;
  date: string;
  backlogCount: number;
  aiConfigured: boolean;
  onOpenSettings: () => void;
  onOpenWrong: () => void;
  onStart: (item: RepairCase) => void;
  onOpenPaper: (item: RepairCase) => void;
  onReplace: (item: RepairCase) => void;
  onOpenPractice: () => void;
  onRefresh: () => void;
};

const statusText: Record<string, string> = {
  new: '待诊断',
  generating: 'AI 正在修复',
  ready: '修复卷已就绪',
  grading: 'AI 正在批改',
  needs_retry: '还需要再练',
  passed: '本轮通过',
  completed: '已修复',
  failed: '生成失败',
};

function sourceLabel(item: RepairCase) {
  const question = item.question;
  if (!question) return '错题';
  return question.source === 'real' ? `${question.year || '历年'} 真题 · 第 ${question.seq_label} 题` : 'AI 原创题';
}

export function RepairPanel({ cases, loading, busy, date, backlogCount, aiConfigured, onOpenSettings, onOpenWrong, onStart, onOpenPaper, onReplace, onOpenPractice, onRefresh }: RepairPanelProps) {
  const open = cases.filter(item => item.status !== 'completed');
  const completed = cases.filter(item => item.status === 'completed');
  return <section className="repair-page">
    <div className="intro repair-intro">
      <span className="eyebrow">AI 错因修复</span>
      <h1>今日修复</h1>
      <p>每天从错题本固定抽 4 道，固定到今天结束。先让 AI 诊断错因，再针对这个错因生成变式，直到真正掌握。</p>
    </div>
    <div className="repair-overview">
      <div><strong>{open.length}</strong><span>道今日待修复</span></div>
      <div><strong>{completed.length}</strong><span>道今日已完成</span></div>
      <div className="repair-overview-note">抽题固定到 {date || '今天'} · 错题本共 {backlogCount} 道待修复</div>
      <button onClick={onOpenWrong}>去错题本</button>
      <button onClick={onRefresh} disabled={loading || busy}>{loading ? '刷新中…' : '刷新'}</button>
    </div>
    {!aiConfigured && <div className="repair-notice"><span>AI 诊断和修复题生成需要模型服务。</span><button onClick={onOpenSettings}>去配置模型</button></div>}
    {!open.length && !completed.length && <div className="panel repair-empty">
      <span className="eyebrow">从第一道错题开始</span>
      <h2>还没有待修复的错题</h2>
      <p>做一张自由练习卷或每日一题，答错的题会自动进入错题本，并有机会进入明天的今日修复抽题。</p>
      <button className="primary" onClick={onOpenPractice}>去做一张练习卷</button>
    </div>}
    {!!open.length && <div className="repair-list">
      {open.map(item => <article className={`panel repair-card repair-${item.status}`} key={item.id}>
        <div className="repair-card-head">
          <div className="repair-card-meta"><span className="source-tag real">{sourceLabel(item)}</span><span className={`repair-status ${item.status}`}>{statusText[item.status] || item.status}</span></div>
          <span className="repair-case-index">{item.repair_passes || 0}/5 轮 · {item.repair_variants_done || 0}/15 题</span>
        </div>
        <div className="repair-round-bar"><i style={{ width: `${Math.min(100, ((item.repair_passes || 0) / 5) * 100)}%` }} /></div>
        {item.question && <div className="repair-question">
          <div className="stem"><MathText text={item.question.stem_latex} /></div>
          <QuestionFigures assets={item.question.figure_assets} />
        </div>}
        {item.diagnosis ? <div className="repair-diagnosis">
          <div className="repair-diagnosis-head"><strong>AI 诊断</strong><span>{item.diagnosis.confidence ? `置信度 ${item.diagnosis.confidence}%` : '待补充证据'}</span></div>
          <p>{item.diagnosis.summary}</p>
          {item.diagnosis.first_gap && <p className="muted">首个缺口：{item.diagnosis.first_gap}</p>}
          <div className="repair-tags">{item.diagnosis.cause_tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          {item.wrong_answer && <p className="repair-wrong-answer">你的答案：<MathText text={item.wrong_answer} /></p>}
        </div> : <div className="repair-diagnosis repair-diagnosis-pending">
          <strong>{item.status === 'generating' ? 'AI 正在诊断错因…' : '先让 AI 看懂这道错题'}</strong>
          <p>会结合你的错误答案、原题和知识点，找出第一个实质错误，再生成针对性的变式。</p>
          {item.job_detail && <small>{item.job_detail}</small>}
          {item.job_progress != null && item.status === 'generating' && <div className="repair-progress"><i style={{ width: `${item.job_progress}%` }} /></div>}
        </div>}
        <div className="repair-actions">
          {item.status === 'generating' ? <span className="repair-action-note">{item.job_stage || '正在生成'} · {item.job_progress ?? 0}%</span>
            : item.status === 'grading' ? <><span className="repair-action-note">AI 正在按步骤批改本轮变式，完成后自动记录轮次</span>{item.paper_id && <button className="primary" onClick={() => onOpenPaper(item)}>查看批改进度 →</button>}</>
            : item.status === 'ready' ? <button className="primary" onClick={() => onOpenPaper(item)}>打开修复卷 →</button>
            : item.status === 'needs_retry' ? <button className="primary" onClick={() => onStart(item)} disabled={busy}>继续生成变式 →</button>
            : item.status === 'passed' ? (item.next_repair_at && new Date(item.next_repair_at) > new Date()
              ? <span className="repair-action-note">本轮通过 · 下一轮 {new Date(item.next_repair_at).toLocaleDateString('zh-CN')} 后可再来</span>
              : <button className="primary" onClick={() => onStart(item)} disabled={busy}>开始下一轮 →</button>)
            : item.status === 'completed' ? <span className="repair-action-note">5 轮全部通过，可以移出错题本</span>
            : <button className="primary" onClick={() => onStart(item)} disabled={busy}>{item.status === 'failed' ? '重新生成变式 →' : '生成该题变式 →'}</button>}
          {!['generating', 'grading', 'passed', 'completed'].includes(item.status) && <button className="repair-swap" onClick={() => onReplace(item)} disabled={busy}>替换这道题</button>}
        </div>
      </article>)}
    </div>}
    {!!completed.length && <div className="repair-completed">
      <h2>已修复</h2>
      {completed.map(item => <div className="repair-completed-row" key={item.id}><span>{sourceLabel(item)}</span><span>{item.repair_variants_done || 0}/15 题 · 5 轮已掌握</span></div>)}
    </div>}
  </section>;
}
