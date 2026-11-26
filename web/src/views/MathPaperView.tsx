import { MathText } from '../components/MathText';
import { QuestionFigures } from '../components/QuestionFigures';
import { difficultyLabel, formatScore } from '../lib/api';
import type { GradeResult, Paper, PaperGrading } from '../types';

export function MathPaperView({ paper, answers, confirmedLatex, recognizing, recognitionNotes, expandedReviews, result, grading, answered, elapsed, busy, selectedNames, paperOrigin, onBack, onAnswer, onConfirmedLatex, onRecognize, onToggleReview, onSubmit, onRetryGrading, onLoadRepair, onLoadWrong, onCompose }: {
  paper: Paper;
  answers: Record<string, string>;
  confirmedLatex: Record<string, string>;
  recognizing: Record<string, boolean>;
  recognitionNotes: Record<string, string>;
  expandedReviews: Record<string, boolean>;
  result: GradeResult | null;
  grading: PaperGrading | null;
  answered: number;
  elapsed: number;
  busy: boolean;
  selectedNames: string[];
  paperOrigin: 'compose' | 'papers' | 'repair' | 'exams';
  onBack: () => void;
  onAnswer: (questionId: string, value: string) => void;
  onConfirmedLatex: (questionId: string, value: string) => void;
  onRecognize: (questionId: string, file: File) => void;
  onToggleReview: (questionId: string) => void;
  onSubmit: () => void;
  onRetryGrading: () => void;
  onLoadRepair: () => void;
  onLoadWrong: () => void;
  onCompose: () => void;
}) {
  const attemptMap = new Map(result?.attempts.map(attempt => [attempt.question_id, attempt]) || []);
  const backLabel = paperOrigin === 'papers' ? '我的试卷' : paperOrigin === 'repair' ? '今日修复' : paperOrigin === 'exams' ? '真题试卷' : '自由练习';
  const pendingCount = grading?.pending_count ?? result?.attempts.filter(attempt => attempt.grading_status === 'pending_review').length ?? 0;
  const gradingFailed = grading?.status === 'failed';

  return <>
    <div className="paper-toolbar no-print"><button className="back" onClick={onBack}>← {backLabel}</button></div>
    <section className="paper-head">
      <span className="eyebrow">{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</span>
      <h1>{paper.title || (paper.origin === 'variant' ? '错题仿真练习' : selectedNames.join(' · ')) || '数学二练习卷'}</h1>
      <p>{paper.items_json.length} 题 · 卷面 {formatScore(paper.total_score_x2)} 分 · {paper.actual_ratio.real} 道真题 / {paper.actual_ratio.ai} 道 AI 原创</p>
      <details className="paper-notes">
        <summary>组卷说明{paper.adjustments.length ? ` · ${paper.adjustments.length} 条调整` : ''}</summary>
        <div>
          <p>{paper.mode === 'exam' ? '本卷难度按易 → 中 → 难梯度分布。' : '本卷按所选难度档集中练习。'} 分值按题库记录计算。</p>
          {paper.items_json.some(item => item.question.score_source?.startsWith('derived')) && <p>分值说明：本卷分值按官方题型总分推导，不是官方逐题分值。</p>}
          {paper.items_json.every(item => item.question.is_fixture) && <p>当前为本地契约样例数据：题目为开发用样例，不代表官方真题。</p>}
          {paper.adjustments.map(adjustment => <p key={adjustment}>已调整：{adjustment}</p>)}
        </div>
      </details>
    </section>
    <div className="paper-progress no-print"><span>已作答 {answered} / {paper.items_json.length}</span><div><i style={{ width: `${answered / paper.items_json.length * 100}%` }} /></div><span className="timer">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>{!result && <button className="primary small paper-submit-top" disabled={busy} onClick={onSubmit}>{busy ? '正在判卷…' : '提交并判卷'}</button>}</div>
    <section className="question-list">{paper.items_json.map((item, index) => {
      const question = item.question, attempt = attemptMap.get(question.id);
      const reviewOpen = Boolean(expandedReviews[question.id]);
      const hasReviewDetails = Boolean(attempt?.explanation) || Boolean(attempt?.solution_steps?.length);
      const isPending = attempt?.grading_status === 'pending_review';
      return <article className={`question-card ${attempt && !isPending ? (attempt.score_x2 === attempt.max_score_x2 ? 'correct' : 'incorrect') : ''}`} key={question.id}>
        <div className="question-meta"><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className={`source-tag ${question.is_fixture ? 'fixture' : question.source}`}>{question.is_fixture ? '本地契约样例 · 非真题' : question.source === 'real' ? `${question.year || '历年'} 真题 · 第 ${question.seq_label} 题` : 'AI 原创 · 已校验'}</span><span>{question.qtype === 'single_choice' ? '选择题' : question.qtype === 'fill_blank' ? '填空题' : '解答题'}</span><span>难度：{difficultyLabel(question.difficulty)}</span><span>{formatScore(item.score_x2)} 分</span></div>
        <div className="stem"><MathText text={question.stem_latex} /></div>
        <QuestionFigures assets={question.figure_assets} />
        {question.sub_items_json?.map(sub => <div className="sub-item" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
        {question.qtype === 'single_choice' && <div className="answer-options">{question.options_json?.map(option => {
          const correctLabel = attempt?.correct_answer?.trim().toUpperCase();
          const isCorrect = Boolean(attempt) && correctLabel === option.label;
          const isChosen = answers[question.id] === option.label;
          return <button key={option.label} disabled={Boolean(attempt)} className={`${isChosen ? 'chosen' : ''} ${attempt ? (isCorrect ? 'correct-option' : isChosen ? 'wrong-option' : '') : ''}`} onClick={() => onAnswer(question.id, option.label)}>
            <b>{option.label}</b><MathText text={option.latex} />{isCorrect && <span className="mark correct">✓</span>}{Boolean(attempt) && isChosen && !isCorrect && <span className="mark wrong">✗</span>}
          </button>;
        })}</div>}
        {question.qtype === 'fill_blank' && <input className="blank-answer" disabled={Boolean(attempt)} value={answers[question.id] || ''} onChange={e => onAnswer(question.id, e.target.value)} placeholder="填写答案，如 1 或 e^x" />}
        {question.qtype === 'free_response' && <div className="solution-input"><label className="upload-label">{recognizing[question.id] ? '正在识别手写解答…' : '上传手写解答'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={recognizing[question.id] || Boolean(attempt)} onChange={e => { const file = e.target.files?.[0]; if (file) onRecognize(question.id, file); }} /></label><textarea disabled={Boolean(attempt)} value={answers[question.id] || ''} onChange={e => { onAnswer(question.id, e.target.value); onConfirmedLatex(question.id, e.target.value); }} placeholder="上传手写照片后自动转写，也可以直接输入 LaTeX 或文字。" rows={4} />{recognitionNotes[question.id] && <p className="recognition-note">{recognitionNotes[question.id]}</p>}</div>}
        {attempt && <div className="answer-review">
          <button type="button" className="correct-answer" onClick={() => onToggleReview(question.id)} aria-expanded={reviewOpen}>
            <strong>正确答案</strong>{attempt.correct_answer ? <MathText text={attempt.correct_answer} /> : <span>—</span>}
            {hasReviewDetails && <span className="expand-detail">{reviewOpen ? '收起解析 ▲' : '查看解析 ▼'}</span>}
          </button>
          {reviewOpen && <div className="answer-detail">
            {attempt.explanation && <p><strong>考点解析</strong><MathText text={attempt.explanation} /></p>}
            {attempt.solution_steps && attempt.solution_steps.length > 0 && <ol>{attempt.solution_steps.map((step, stepIndex) => <li key={stepIndex}><MathText text={step} /></li>)}</ol>}
            {!attempt.explanation && !attempt.solution_steps?.length && <p className="muted">这道题暂无更多解析。</p>}
          </div>}
          <div className="score-line">{isPending ? '解答题待 AI 批改' : `本题得分 ${formatScore(attempt.score_x2)} / ${formatScore(attempt.max_score_x2)}`}</div>
        </div>}
        {attempt && <div className="question-feedback"><strong>{isPending ? (gradingFailed ? '批改暂时失败，可点上方「重新批改」' : 'AI 正在按步骤批改') : attempt.score_x2 === attempt.max_score_x2 ? '回答正确' : '需要再看一眼'}</strong><span>{attempt.feedback || (isPending ? '批改完成后自动更新得分与错题本。' : `得分 ${formatScore(attempt.score_x2)} / ${formatScore(attempt.max_score_x2)}`)}</span></div>}
      </article>;
    })}</section>
    {result && <section className="grade-result no-print" id="grade-result"><span className="eyebrow">本次作答</span><h2>得分率 {result.score_rate_bp / 100}%</h2><p>得分 {formatScore(result.score_x2)} / {formatScore(result.max_score_x2)}。{pendingCount ? '解答题还在批改，完成后总分与错题本会自动更新。' : '错题已自动加入错题本。'}</p>{pendingCount > 0 && <div className="grading-notice" role="status"><span className="agent-thinking"><i /><i /><i /></span><span>{gradingFailed ? '解答题批改暂时失败，作答已保存。' : `AI 正在按步骤批改 ${pendingCount} 道解答题，通常需要几秒到 1 分钟…`}</span>{gradingFailed && <button onClick={onRetryGrading} disabled={busy}>{busy ? '正在重试…' : '重新批改'}</button>}</div>}<div className="source-score">{Object.entries(result.by_source).filter(([, value]) => value.max_score_x2 > 0).map(([key, value]) => <div key={key}><span>{key === 'real' ? '真题部分' : 'AI 原创部分'}</span><strong>{formatScore(value.score_x2)} / {formatScore(value.max_score_x2)}</strong></div>)}</div><div className="result-actions"><button onClick={onLoadRepair}>开始修复 →</button><button onClick={onLoadWrong}>查看错题本</button><button onClick={onCompose}>自由练习</button></div></section>}
  </>;
}
