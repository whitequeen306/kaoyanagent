import { useState } from 'react';
import { MathText } from './MathText';
import { QuestionFigures } from './QuestionFigures';
import { difficultyLabel } from '../lib/api';
import type { DailyAnswerImage, DailyQuestionState, Qtype } from '../types';

type DailyQuestionCardProps = {
  daily: DailyQuestionState;
  answer: string;
  answerImage: DailyAnswerImage | null;
  busy: boolean;
  reading: boolean;
  error: string;
  modelConfigured: boolean;
  onSettings: () => void;
  onWrong: () => void;
  aiBusy: boolean;
  aiPrompt: string;
  onAnswerChange: (value: string) => void;
  onImageSelect: (file: File) => void;
  onImageRemove: () => void;
  onSubmit: () => void;
  onAiPromptChange: (value: string) => void;
  onAiAsk: (prompt: string) => void;
};

const instructions: Record<Qtype, string> = {
  single_choice: '单选题 · 选择一个选项，提交后按选项核对。',
  fill_blank: '填空题 · 填写结果。答案明确匹配时直接判定，其他写法由模型判断是否等价。',
  free_response: '解答题 · 写出步骤和结论，或上传手写过程，由模型判定。',
};

export function DailyQuestionCard({
  daily, answer, answerImage, busy, reading, error, modelConfigured, onSettings, onWrong,
  aiBusy, aiPrompt, onAnswerChange, onImageSelect, onImageRemove, onSubmit, onAiPromptChange, onAiAsk,
}: DailyQuestionCardProps) {
  const { question, result } = daily;
  const retryable = result?.correct === null && result.retryable;
  const submitted = daily.status === 'submitted' && !retryable;
  const review = submitted ? result?.review : null;
  const judgmentClass = retryable ? 'retryable' : result?.correct === true ? 'correct' : result?.correct === false ? 'incorrect' : '';
  const chosenLabel = submitted ? result?.answer_raw : answer;
  const modelNeeded = Boolean(answerImage) || question.qtype === 'free_response';
  const [expanded, setExpanded] = useState(false);
  if (!expanded) {
    const compactStatus = submitted ? (result?.correct === true ? '今日已答对' : result?.correct === false ? '今日已答错' : '今日已作答') : '今日练习';
    return <section className="daily-card daily-card-compact">
      <div className="daily-compact-head">
        <div>
          <span className="eyebrow">{compactStatus}</span>
          <h2>每日一题</h2>
          <p>{daily.date} · {question.source === 'real' ? `${question.year || '历年'} 真题` : 'AI 原创'} · 难度：{difficultyLabel(question.difficulty)}</p>
        </div>
        <button className="primary small" onClick={() => setExpanded(true)}>{submitted ? '查看今日一题' : '开始今日一题'}</button>
      </div>
      <p className="daily-compact-stem"><MathText text={question.stem_latex} /></p>
    </section>;
  }
  return <section className="daily-card">
    <header className="daily-card-head">
      <h2>每日一题</h2>
      <div className="daily-card-actions"><time dateTime={daily.date}>{daily.date}</time><button className="text-button" onClick={() => setExpanded(false)}>收起</button></div>
    </header>
    <article className={`daily-question ${judgmentClass}`}>
      <div className="question-meta">
        <span className={`source-tag ${question.source}`}>{question.source === 'real' ? `${question.year || '历年'} 真题` : 'AI 原创'}</span>
        <span>难度：{difficultyLabel(question.difficulty)}</span>
      </div>
      <div className="stem"><MathText text={question.stem_latex} /></div>
      <QuestionFigures assets={question.figure_assets} />
      {question.sub_items_json?.map(sub => <div className="sub-item" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
      {!submitted && <p>{instructions[question.qtype]}</p>}
      {question.qtype === 'single_choice' && <div className="answer-options">{question.options_json?.map(option => {
        const chosen = chosenLabel === option.label;
        return <button key={option.label} disabled={submitted || busy} aria-pressed={chosen} className={chosen ? 'chosen' : ''} onClick={() => onAnswerChange(option.label)}>
          <b>{option.label}</b><MathText text={option.latex} />
        </button>;
      })}</div>}
      {!submitted && <>
        {question.qtype === 'fill_blank' && <input aria-label="填空答案" className="blank-answer" disabled={busy} value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="填写结果" />}
        {question.qtype === 'free_response' && <textarea aria-label="解题过程" className="daily-answer-textarea" disabled={busy} value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="填写步骤和结论" rows={4} />}
        <div className="daily-answer-tools">
          <label className="daily-upload">
            <span>{reading ? '正在读取图片…' : answerImage ? '替换作答图片' : '上传作答图片'}</span>
            <small>PNG / JPG / WebP，限 4 MB。提交时图片会发送给本设备配置的视觉模型。</small>
            <input type="file" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={event => {
              const file = event.target.files?.[0];
              if (file) onImageSelect(file);
              event.currentTarget.value = '';
            }} />
          </label>
          {answerImage && <div className="daily-image-preview">
            <img src={answerImage.data_url} alt="待提交的作答图片" />
            <div><strong>{answerImage.name}</strong><button disabled={busy} onClick={onImageRemove}>移除图片</button></div>
          </div>}
        </div>
        {error && <p role="alert">{error}</p>}
        {(error || (!modelConfigured && modelNeeded) || retryable) && <div className="daily-settings">
          {!modelConfigured && modelNeeded && <span>请先配置判定所需的模型。</span>}
          <button onClick={onSettings} disabled={busy}>模型设置</button>
        </div>}
        <div className="daily-submit-row"><span>只判对错，不计分。</span><button className="primary" disabled={busy || reading || (!answer.trim() && !answerImage)} onClick={onSubmit}>{busy ? '正在判定…' : '提交作答'}</button></div>
      </>}
      {(submitted || retryable) && result && <div className={`daily-judgment ${judgmentClass}`} role="status">
        <strong>{retryable ? '尚未判定' : result.correct ? '回答正确' : '回答错误'}</strong>
        {submitted && <div>你的作答：{result.answer_kind === 'image' && '图片已判定'}{result.answer_raw && <MathText text={result.answer_raw} />}{result.answer_kind === 'text' && !result.answer_raw && '无原文记录'}</div>}
        {result.feedback && <MathText text={result.feedback} />}
        {retryable && <div>请调整文字作答或换一张清晰的图片后重新提交。</div>}
      </div>}
      {review && <details className="daily-review"><summary>查看题库参考解答</summary>
        {review.correct_answer && <p><strong>参考答案</strong><MathText text={review.correct_answer} /></p>}
        {review.explanation && <p><MathText text={review.explanation} /></p>}
        {review.solution_steps.length > 0 && <ol>{review.solution_steps.map((step, index) => <li key={index}><MathText text={step} /></li>)}</ol>}
      </details>}
      {submitted && result?.correct === false && result.in_wrong_book && <button className="daily-wrong-link" onClick={onWrong}>查看错题本</button>}
    </article>
    {submitted && <div className="daily-ai-panel">
      <div className="daily-ai-messages">{daily.ai_messages.map((message, index) => <div className={`daily-ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'assistant' ? 'AI' : '你'}</span><MathText text={message.content} /></div>)}</div>
      <div className="daily-ai-actions"><button className="primary" disabled={aiBusy} onClick={() => onAiAsk('')}>{aiBusy ? '正在思考…' : 'AI 讲解这道题'}</button><div className="daily-ai-followup"><input aria-label="追问内容" value={aiPrompt} onChange={event => onAiPromptChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !aiBusy && aiPrompt.trim()) onAiAsk(aiPrompt); }} placeholder="写下你不理解的步骤" /><button disabled={aiBusy || !aiPrompt.trim()} onClick={() => onAiAsk(aiPrompt)}>追问</button></div></div>
      {aiBusy && <p className="muted">AI 讲解通常需要 10–60 秒，取决于模型服务；页面不会重复提交。</p>}
    </div>}
  </section>;
}
