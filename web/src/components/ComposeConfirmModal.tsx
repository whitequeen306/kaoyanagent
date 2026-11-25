import { difficultyLabel } from '../lib/api';
import { sourceOptions } from '../lib/paperMeta';
import type { PaperMode, Qtype, SourceMode } from '../types';

export function ComposeConfirmModal({ open, selectedNames, mode, source, totalCount, mixedRealCount, mixedAiCount, typeCounts, difficulty, onClose, onConfirm }: {
  open: boolean;
  selectedNames: string[];
  mode: PaperMode;
  source: SourceMode;
  totalCount: number;
  mixedRealCount: number;
  mixedAiCount: number;
  typeCounts: Record<Qtype, number>;
  difficulty: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="确认组卷"><div className="confirm-card"><span className="eyebrow">生成前确认</span><h2>按这个配置出卷？</h2><dl><div><dt>知识块</dt><dd>{selectedNames.join('、')}</dd></div><div><dt>模式</dt><dd>{mode === 'exam' ? '整卷模考 · 易中难梯度' : '专项突破 · 同档集中练习'}</dd></div><div><dt>题源</dt><dd>{sourceOptions.find(option => option.value === source)?.label} · 共 {totalCount} 题{source === 'mixed' ? `（真题 ${mixedRealCount} / AI ${mixedAiCount}）` : ''}</dd></div><div><dt>题型</dt><dd>选择 {typeCounts.single_choice} · 填空 {typeCounts.fill_blank} · 解答 {typeCounts.free_response}</dd></div><div><dt>难度</dt><dd>{difficultyLabel(difficulty)}</dd></div></dl><p>{source === 'real' ? '试卷生成后会固定题序和题目版本，作答记录可回看。' : 'AI 出卷在后台进行，完成后会在右下角通知；期间你可以继续组下一张卷。'}</p><div className="modal-actions"><button onClick={onClose}>返回修改</button><button className="primary" onClick={onConfirm}>确认并生成</button></div></div></div>;
}
