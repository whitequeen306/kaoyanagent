import { PdfPaper } from './PdfPaper';
import type { Paper } from '../types';

export function PdfExportOverlays({ choiceOpen, paper, busy, stage, message, onCloseChoice, onSave }: {
  choiceOpen: boolean;
  paper: Paper | null;
  busy: boolean;
  stage: { paper: Paper; includeAnswers: boolean } | null;
  message: string;
  onCloseChoice: () => void;
  onSave: (paper: Paper, includeAnswers: boolean) => void;
}) {
  return <>
    {choiceOpen && paper && <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="保存为 PDF" onClick={() => { if (!busy) onCloseChoice(); }}><div className="pdf-choice-card" onClick={event => event.stopPropagation()}>
      <span className="eyebrow">导出试卷</span><h2>保存为 PDF</h2>
      <p>{paper.title || '数学二练习卷'} · {paper.items_json.length} 题 · {paper.status === 'submitted' ? '已交卷' : '待完成'}</p>
      <p className="pdf-hint">保存窗口默认打开桌面，也可以在选择窗口中更换位置。</p>
      {paper.status === 'submitted' ? <div className="pdf-choice-options">
        <button className="pdf-choice-option" onClick={() => onSave(paper, true)}><strong>带作答与解析</strong><small>保留你的作答、正确答案和解析，适合复盘。</small></button>
        <button className="pdf-choice-option" onClick={() => onSave(paper, false)}><strong>空白卷</strong><small>不含作答痕迹，适合重新练习。</small></button>
      </div> : <button className="primary" onClick={() => onSave(paper, false)}>保存空白卷 PDF</button>}
      <div className="modal-actions"><button onClick={onCloseChoice} disabled={busy}>取消</button></div>
    </div></div>}
    {stage && <div className="pdf-export-overlay"><div className="pdf-export-status">{message}</div><div className="pdf-export-scroll"><PdfPaper paper={stage.paper} includeAnswers={stage.includeAnswers} /></div></div>}
  </>;
}
