import { MathText } from './MathText';
import { difficultyLabel, formatScore } from '../lib/api';
import type { DailyQuestionState, Qtype } from '../types';

type DailyQuestionCardProps = {
  daily: DailyQuestionState;
  answer: string;
  busy: boolean;
  aiBusy: boolean;
  aiPrompt: string;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
  onAiPromptChange: (value: string) => void;
  onAiAsk: (prompt: string) => void;
};

const qtypeLabel = (qtype: Qtype) => ({
  single_choice: '选择题', fill_blank: '填空题', free_response: '解答题',
}[qtype]);

export function DailyQuestionCard({
  daily, answer, busy, aiBusy, aiPrompt, onAnswerChange, onSubmit,
  onAiPromptChange, onAiAsk,
}: DailyQuestionCardProps) {
  const question = daily.question;
  const submitted = daily.status === 'submitted';
  const attempt = daily.result?.attempts[0];
  const hasDetails = Boolean(attempt?.explanation) || Boolean(attempt?.solution_steps?.length);
  return <section className={`daily-card ${submitted ? 'submitted' : ''}`}>
    <div className="daily-card-head">
      <div>
        <span className="eyebrow">每日一题 · {daily.date}</span>
        <h2>今天练一道，保持手感</h2>
        <p>{daily.reason.text}</p>
      </div>
      <span className={`source-tag ${question.source}`}>{submitted ? '已完成' : '今日挑战'}</span>
    </div>
    <article className={`daily-question ${attempt ? (attempt.score_x2 === attempt.max_score_x2 ? 'correct' : 'incorrect') : ''}`}>
      <div className="question-meta">
        <span className="question-number">01</span>
        <span className={`source-tag ${question.source}`}>{question.source === 'real' ? `${question.year || '历年'} 真题` : 'AI 原创'}</span>
        <span>{qtypeLabel(question.qtype)}</span>
        <span>难度：{difficultyLabel(question.difficulty)}</span>
        <span>{formatScore(question.score_x2)} 分</span>
      </div>
      <div className="stem"><MathText text={question.stem_latex} /></div>
      {question.sub_items_json?.map(sub => <div className="sub-item" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
      {question.qtype === 'single_choice' && <div className="answer-options">{question.options_json?.map(option => {
        const correct = attempt?.correct_answer?.trim().toUpperCase() === option.label;
        const chosen = answer === option.label;
        return <button key={option.label} disabled={submitted} className={`${chosen ? 'chosen' : ''} ${attempt ? (correct ? 'correct-option' : chosen ? 'wrong-option' : '') : ''}`} onClick={() => onAnswerChange(option.label)}>
          <b>{option.label}</b><MathText text={option.latex} />{correct && <span className="mark correct">✓</span>}{attempt && chosen && !correct && <span className="mark wrong">✗</span>}
        </button>;
      })}</div>}
      {question.qtype === 'fill_blank' && <input className="blank-answer" disabled={submitted} value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="填写答案，如 1 或 e^x" />}
      {question.qtype === 'free_response' && <textarea className="daily-answer-textarea" disabled={submitted} value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="写下你的解题过程" rows={4} />}
      {!submitted && <div className="daily-submit-row"><span>先独立作答，再查看解析。</span><button className="primary" disabled={busy} onClick={onSubmit}>{busy ? '正在判卷…' : '提交答案 →'}</button></div>}
      {attempt && <div className="answer-review">
        <div className="correct-answer"><strong>正确答案</strong>{attempt.correct_answer ? <MathText text={attempt.correct_answer} /> : <span>—</span>}</div>
        {hasDetails && <div className="answer-detail">
          {attempt.explanation && <p><strong>考点解析</strong><MathText text={attempt.explanation} /></p>}
          {attempt.solution_steps && attempt.solution_steps.length > 0 && <ol>{attempt.solution_steps.map((step, index) => <li key={index}><MathText text={step} /></li>)}</ol>}
        </div>}
        <div className="score-line">本题得分 {formatScore(attempt.score_x2)} / {formatScore(attempt.max_score_x2)} · {daily.result?.score_rate_bp ? `${daily.result.score_rate_bp / 100}%` : '0%'}</div>
      </div>}
    </article>
    {submitted && <div className="daily-ai-panel">
      <div><strong>想把这道题真正吃透？</strong><span>AI 会结合你的本次作答给出讲解和下一步提醒。</span></div>
      <div className="daily-ai-messages">{daily.ai_messages.map((message, index) => <div className={`daily-ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'assistant' ? 'AI' : '你'}</span><MathText text={message.content} /></div>)}</div>
      <div className="daily-ai-actions"><button className="primary" disabled={aiBusy} onClick={() => onAiAsk('')}>{aiBusy ? '正在思考…' : 'AI 讲解这道题'}</button><div className="daily-ai-followup"><input value={aiPrompt} onChange={event => onAiPromptChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) onAiAsk(aiPrompt); }} placeholder="继续追问，例如：我为什么会错？" /><button disabled={aiBusy || !aiPrompt.trim()} onClick={() => onAiAsk(aiPrompt)}>追问</button></div></div>
    </div>}
  </section>;
}
