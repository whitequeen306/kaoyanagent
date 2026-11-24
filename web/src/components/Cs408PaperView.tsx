import { useEffect, useMemo, useState } from 'react';
import { formatScore } from '../lib/api';
import { Cs408QuestionCard } from './Cs408QuestionCard';
import type { Cs408Paper } from '../types';

export function Cs408PaperView({ paper, answers, busy, onAnswer, onSubmit, onBack, onWrong, backLabel }: {
  paper: Cs408Paper;
  answers: Record<string, string>;
  busy: boolean;
  onAnswer: (questionId: string, value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onWrong: () => void;
  backLabel?: string;
}) {
  const isPractice = paper.origin === 'cs408_practice';
  const isRepair = paper.origin === 'repair' || paper.origin === 'cs408_repair';
  const result = paper.result;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (result) return;
    const started = paper.created_at ? new Date(paper.created_at).getTime() : Date.now();
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [paper.id, Boolean(result)]);
  const attemptMap = useMemo(() => new Map(result?.attempts.map(attempt => [attempt.question_id, attempt]) || []), [result]);
  const singleItems = paper.items.filter(item => item.question.qtype === 'single_choice');
  const freeItems = paper.items.filter(item => item.question.qtype === 'free_response');
  const answeredSingle = singleItems.filter(item => answers[item.question_id]).length;
  const answeredFree = freeItems.filter(item => (answers[item.question_id] || '').trim()).length;
  const correctSingle = result?.attempts.filter(attempt => attempt.max_score_x2 > 0 && attempt.score_x2 === attempt.max_score_x2).length || 0;

  return <>
    <div className="paper-toolbar no-print"><button className="back" onClick={onBack}>← {backLabel || (isRepair ? '408 今日修复' : isPractice ? '408 自由练习' : '408 历年真题')}</button></div>
    <section className="paper-head cs408-paper-head">
      <span className="eyebrow">{isRepair ? '408 错题修复' : isPractice ? '408 专项练习' : '408 真题整卷'} · 自动判分 {formatScore(paper.auto_score_x2)} 分</span>
      <h1>{paper.title}</h1>
      <p>{paper.items.length} 题 · {freeItems.length ? `${singleItems.length} 单选 / ${freeItems.length} 综合` : '单选专项'} · 单选自动判分{freeItems.length ? '，综合题对照解析自评' : ''}</p>
      <details className="paper-notes">
        <summary>判分说明</summary>
        <div>
          <p>单项选择题按答案自动判分，每题 2 分。</p>
          {freeItems.length > 0 && <p>综合应用题保留作答区，不自动判分；交卷后展示参考答案与解析，请自己对照估分。</p>}
          {isRepair && <p>这 3 道题由 AI 根据错因生成，已通过独立盲解校验；全部答对才算本轮通过。</p>}
          <p>错题会自动加入 408 错题本。{isPractice ? '本卷按大纲章节自动组题。' : isRepair ? '' : '2026 年为公开回忆整理版。'}</p>
        </div>
      </details>
    </section>
    <div className="paper-progress no-print cs408-progress">
      <span>单选 {answeredSingle} / {singleItems.length}{freeItems.length ? ` · 综合 ${answeredFree} / ${freeItems.length}` : ''}</span>
      <div><i style={{ width: `${(answeredSingle + answeredFree) / paper.items.length * 100}%` }} /></div>
      <span className="timer">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
      {!result && <button className="primary small paper-submit-top" disabled={busy} onClick={onSubmit}>{busy ? '正在判卷…' : '交卷并判分'}</button>}
    </div>
    {result && <section className="grade-result cs408-result" id="cs408-result">
      <span className="eyebrow">本次单选自动判分</span>
      <h2>{formatScore(result.score_x2)} / {formatScore(result.max_score_x2)} 分 · 得分率 {Math.round(result.score_rate_bp / 100)}%</h2>
      <p>单选答对 {correctSingle} / {singleItems.length} 道{freeItems.length ? `；综合题 ${answeredFree} / ${freeItems.length} 道已写，交卷后可对照解析自评` : ''}。{isRepair ? '全部答对才算本轮通过。' : ''}</p>
      <div className="result-actions"><button onClick={onWrong}>查看 408 错题本</button><button onClick={onBack}>{isRepair ? '返回今日修复 →' : isPractice ? '再练一组 →' : '再选一年 →'}</button></div>
    </section>}
    <section className="question-list cs408-question-list">{paper.items.map((item, index) => {
      const attempt = attemptMap.get(item.question_id);
      return <Cs408QuestionCard
        key={item.question.id}
        question={item.question}
        index={index}
        answer={answers[item.question_id] || ''}
        onAnswer={value => onAnswer(item.question.id, value)}
        review={attempt || null}
      />;
    })}</section>
  </>;
}
