import { MathText } from './MathText';
import type { Attempt, Paper } from '../types';

const qtypeLabel = (value: string) => ({ single_choice: '选择题', fill_blank: '填空题', free_response: '解答题' }[value] || value);
const formatScore = (x2: number) => Number.isInteger(x2 / 2) ? String(x2 / 2) : (x2 / 2).toFixed(1);

export function PdfPaper({ paper, includeAnswers }: { paper: Paper; includeAnswers: boolean }) {
  const attempts = new Map<string, Attempt>((paper.result?.attempts || []).map(attempt => [attempt.question_id, attempt]));
  const title = paper.title || '数学二练习卷';
  const created = paper.created_at ? new Date(paper.created_at).toLocaleString('zh-CN') : '';
  return <div className="pdf-paper" id="pdf-export-paper">
    <header className="pdf-header"><span>研数 · 考研数学二助手</span><span>{created}</span></header>
    <h1 className="pdf-title">{title}</h1>
    <div className="pdf-sub">{paper.items_json.length} 题 · 卷面 {formatScore(paper.total_score_x2)} 分 · {paper.mode === 'exam' ? '整卷模考' : '专项突破'}{includeAnswers ? ' · 含作答与解析' : ' · 空白卷'}</div>
    <div className="pdf-rule" />
    {paper.items_json.map((item, index) => {
      const question = item.question;
      const attempt = attempts.get(question.id);
      const correctLabel = attempt?.correct_answer?.trim().toUpperCase();
      return <section className="pdf-question" key={question.id}>
        <div className="pdf-qmeta">
          <strong>{String(index + 1).padStart(2, '0')}</strong>
          <span>{qtypeLabel(question.qtype)}</span>
          <span>{formatScore(item.score_x2)} 分</span>
          <span>{question.source === 'real' ? `${question.year || '历年'} 真题 · 第 ${question.seq_label} 题` : 'AI 原创 · 已校验'}</span>
          {includeAnswers && attempt ? <span className={attempt.score_x2 === attempt.max_score_x2 ? 'pdf-tag-right' : 'pdf-tag-wrong'}>{attempt.score_x2 === attempt.max_score_x2 ? '回答正确' : '回答错误'}</span> : null}
        </div>
        <div className="pdf-stem"><MathText text={question.stem_latex} /></div>
        {question.sub_items_json?.map(sub => <div className="pdf-subitem" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
        {question.qtype === 'single_choice' && question.options_json?.length ? <div className="pdf-options">{question.options_json.map(option => {
          const isCorrect = includeAnswers && correctLabel === option.label;
          const isChosen = includeAnswers && attempt?.answer_raw === option.label;
          return <div key={option.label} className={`pdf-option ${isCorrect ? 'pdf-correct' : ''} ${isChosen && !isCorrect ? 'pdf-wrong' : ''}`}>
            <b>{option.label}</b><MathText text={option.latex} />
            {isCorrect ? <span className="pdf-mark">✓</span> : null}
            {isChosen && !isCorrect ? <span className="pdf-mark">✗</span> : null}
          </div>;
        })}</div> : null}
        {!includeAnswers && question.qtype !== 'single_choice' ? <div className="pdf-workspace" /> : null}
        {includeAnswers && attempt ? <div className="pdf-answer">
          {attempt.answer_raw ? <p><strong>你的作答：</strong><MathText text={attempt.answer_raw} /></p> : <p><strong>你的作答：</strong>未作答</p>}
          <p><strong>正确答案：</strong><MathText text={attempt.correct_answer || '—'} /></p>
          {attempt.explanation ? <p><strong>解析：</strong><MathText text={attempt.explanation} /></p> : null}
          {attempt.solution_steps?.length ? <ol>{attempt.solution_steps.map((step, stepIndex) => <li key={stepIndex}><MathText text={step} /></li>)}</ol> : null}
        </div> : null}
      </section>;
    })}
  </div>;
}
