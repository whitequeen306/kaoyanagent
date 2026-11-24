import { Cs408QuestionCard } from './Cs408QuestionCard';
import type { Cs408WrongItem } from '../types';

export function Cs408WrongBook({ items, loading }: { items: Cs408WrongItem[]; loading: boolean }) {
  const sorted = items.slice().sort((a, b) => ((b.question.year || 0) - (a.question.year || 0)) || ((b.question.number || 0) - (a.question.number || 0)));
  return <section className="simple-page cs408-page">
    <span className="eyebrow">408 · 单选错题</span>
    <h1>408 错题本</h1>
    <p>只收录 408 整卷里答错的单选题；综合题不自动判分，不进入错题本。</p>
    {loading && !items.length ? <div className="empty-card"><h2>正在加载错题…</h2></div> : items.length === 0
      ? <div className="empty-card"><h2>暂时没有 408 错题</h2><p>做一套 408 真题，答错的单选会自动出现在这里。</p></div>
      : <div className="cs408-wrong-list">{sorted.map(item => <Cs408QuestionCard
        key={item.question_id}
        question={item.question}
        index={(item.question.number || 1) - 1}
        answer={item.attempt?.answer_raw || ''}
        review={item.review}
        readOnly
      />)}</div>}
  </section>;
}
