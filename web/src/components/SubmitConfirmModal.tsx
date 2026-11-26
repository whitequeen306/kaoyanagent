export function SubmitConfirmModal({ open, subject, answered, total, scorePoints, unanswered, gradingPending, busy, onClose, onConfirm }: {
  open: boolean;
  subject: 'math2' | 'cs408';
  answered: number;
  total: number;
  scorePoints: number;
  unanswered: number;
  gradingPending?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="确认交卷"><div className="confirm-card">
    <span className="eyebrow">交卷前确认</span>
    <h2>现在交卷并判分？</h2>
    <dl>
      <div><dt>科目</dt><dd>{subject === 'cs408' ? '408 计算机学科专业基础' : '考研数学二'}</dd></div>
      <div><dt>作答</dt><dd>已作答 {answered} / {total} 题{unanswered ? ` · ${unanswered} 题未作答` : ''}</dd></div>
      <div><dt>卷面</dt><dd>{scorePoints} 分</dd></div>
      {gradingPending && <div><dt>{subject === 'cs408' ? '综合题' : '解答题'}</dt><dd>{subject === 'cs408' ? '单选交卷后自动判分，综合题对照解析自评' : '交卷后由 AI 按步骤逐步批改，通常需要几秒到 1 分钟'}</dd></div>}
    </dl>
    <p>交卷后不能修改答案。未作答的题会记为 0 分并进入复习记录。</p>
    <div className="modal-actions"><button onClick={onClose} disabled={busy}>继续作答</button><button className="primary" onClick={onConfirm} disabled={busy}>{busy ? '正在交卷…' : '确认交卷'}</button></div>
  </div></div>;
}
