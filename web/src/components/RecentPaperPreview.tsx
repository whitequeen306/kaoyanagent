import { MathText } from './MathText';
import { QuestionFigures } from './QuestionFigures';
import { formatScore } from '../lib/api';
import { qtypeLabel, sourceLabel } from '../lib/paperMeta';

export function RecentPaperPreview({ preview, onClose }: { preview: any; onClose: () => void }) {
  return <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="组卷详情" onClick={onClose}>
    <div className="preview-card" onClick={event => event.stopPropagation()}>
      <div className="preview-head"><div><span className="eyebrow">公开组卷预览</span><h2>{preview.concepts?.map((node: any) => node.name).slice(0, 3).join(' · ') || '综合练习'}</h2><p>{preview.mode === 'exam' ? '整卷模考' : '专项突破'} · {sourceLabel(preview.source_mode)} · {preview.items.length} 题 · {formatScore(preview.total_score_x2)} 分</p></div><button className="preview-close" onClick={onClose}>关闭</button></div>
      <p className="preview-note">{preview.note}</p>
      <div className="preview-items">{preview.items.map((item: any, index: number) => <article className="preview-item" key={item.question.id}>
        <div className="question-meta"><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className={`source-tag ${item.question.source}`}>{item.question.source === 'real' ? `${item.question.year || '历年'} 真题` : 'AI 原创'}</span><span>{qtypeLabel(item.question.qtype)}</span><span>{formatScore(item.score_x2)} 分</span></div>
        <div className="stem"><MathText text={item.question.stem_latex} /></div>
        <QuestionFigures assets={item.question.figure_assets} />
        {item.question.options_json?.length ? <div className="preview-options">{item.question.options_json.map((option: any) => <div className="preview-option" key={option.label}><b>{option.label}</b><MathText text={option.latex} /></div>)}</div> : null}
      </article>)}</div>
    </div>
  </div>;
}
