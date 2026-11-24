import { Cs408Html } from './Cs408Html';
import { MathText } from './MathText';
import type { Cs408Attempt, Cs408Question, Cs408Review } from '../types';

type Review = (Cs408Review | Cs408Attempt) & { score_x2?: number; max_score_x2?: number };

export function Cs408QuestionCard({ question, index, answer, onAnswer, review = null, readOnly = false }: {
  question: Cs408Question;
  index: number;
  answer: string;
  onAnswer?: (value: string) => void;
  review?: Review | null;
  readOnly?: boolean;
}) {
  const correct = review?.correct_answer?.trim().toUpperCase();
  const isFree = question.qtype === 'free_response';
  const isAi = question.source === 'ai' || !question.year;
  const sourceText = isAi ? (question.ai_kind === 'variant' ? 'AI 同考点变式' : 'AI 仿真题') : `${question.year} 真题 · 第 ${question.number} 题`;

  return <article className="panel cs408-question-card" id={`cs408-q-${question.id}`}>
    <div className="question-meta">
      <span className="question-number">{String(index + 1).padStart(2, '0')}</span>
      <span className={`source-tag ${isAi ? 'ai' : 'real'}`}>{sourceText}</span>
      <span>{isFree ? '综合应用题' : '单项选择题'}</span>
      <span>{isFree ? '自评' : '2 分'}</span>
    </div>
    <Cs408Html html={question.question_html} />
    {question.options.length > 0 && <div className={`cs408-options ${question.options.some(option => option.image) ? 'with-images' : ''}`}>
      {question.options.map(option => {
        const chosen = answer === option.label;
        const isCorrect = Boolean(review) && correct === option.label.toUpperCase();
        const wrong = Boolean(review) && chosen && !isCorrect;
        return <button
          type="button"
          key={option.label}
          disabled={Boolean(review) || readOnly}
          className={`cs408-option ${chosen ? 'chosen' : ''} ${isCorrect ? 'correct-option' : ''} ${wrong ? 'wrong-option' : ''}`}
          onClick={() => onAnswer?.(option.label)}
        >
          <b>{option.label}</b>
          {option.image
            ? <img src={option.image.url} alt={option.image.alt || `选项 ${option.label}`} width={option.image.width || undefined} height={option.image.height || undefined} />
            : <span className="cs408-option-text"><MathText text={option.text} /></span>}
          {isCorrect && <span className="mark correct">✓</span>}
          {wrong && <span className="mark wrong">✗</span>}
        </button>;
      })}
    </div>}
    {isFree && !review && !readOnly && <div className="cs408-free-input">
      <label htmlFor={`cs408-answer-${question.id}`}>你的解答（可选，不自动判分）</label>
      <textarea
        id={`cs408-answer-${question.id}`}
        value={answer}
        onChange={event => onAnswer?.(event.target.value)}
        rows={4}
        placeholder="可以先写思路，交卷后对照解析自评。"
      />
    </div>}
    {isFree && answer && (review || readOnly) && <div className="cs408-saved-answer"><strong>你的解答</strong><p>{answer}</p></div>}
    {review && <div className="cs408-review">
      <div className="cs408-review-head">
        <strong>{isFree ? '参考答案与解析' : `正确答案 ${correct || '—'}`}</strong>
        {typeof review.score_x2 === 'number' && typeof review.max_score_x2 === 'number' && review.max_score_x2 > 0 && <span>得分 {review.score_x2 / 2} / {review.max_score_x2 / 2}</span>}
        {isFree && <span>综合题不自动判分，请对照解析自评</span>}
      </div>
      {review.explanation_html
        ? <Cs408Html html={review.explanation_html} />
        : review.explanation
          ? <p>{review.explanation}</p>
          : <p className="muted">这道题源数据暂未提供解析。</p>}
    </div>}
  </article>;
}
