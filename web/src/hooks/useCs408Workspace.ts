import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import type {
  Cs408HistoryItem, Cs408Paper, Cs408RepairCase, Cs408RepairPayload,
  Cs408WrongItem, Cs408Year,
} from '../types';
import type { Cs408ComposeOptions } from '../components/Cs408Compose';

type Cs408View = 'compose' | 'repair' | 'papers' | 'paper' | 'wrong' | 'history' | 'agent';
type Cs408Back = 'compose' | 'repair' | 'papers' | 'history';

export function useCs408Workspace({ subject, completedJobCount, aiSettings, openSettings, setError, onQueueJob }: {
  subject: 'math2' | 'cs408';
  completedJobCount: number;
  aiSettings: any;
  openSettings: () => void;
  setError: (message: string) => void;
  onQueueJob: (job: any) => void;
}) {
  const [cs408View, setCs408View] = useState<Cs408View>('papers');
  const [cs408PaperBack, setCs408PaperBack] = useState<Cs408Back>('papers');
  const [cs408Years, setCs408Years] = useState<Cs408Year[]>([]);
  const [cs408Paper, setCs408Paper] = useState<Cs408Paper | null>(null);
  const [cs408Answers, setCs408Answers] = useState<Record<string, string>>({});
  const [cs408Wrong, setCs408Wrong] = useState<Cs408WrongItem[]>([]);
  const [cs408RepairCases, setCs408RepairCases] = useState<Cs408RepairCase[]>([]);
  const [cs408RepairDate, setCs408RepairDate] = useState('');
  const [cs408RepairBacklog, setCs408RepairBacklog] = useState(0);
  const [cs408RepairCompleted, setCs408RepairCompleted] = useState(0);
  const [cs408RepairLoading, setCs408RepairLoading] = useState(false);
  const [cs408History, setCs408History] = useState<Cs408HistoryItem[]>([]);
  const [cs408HistoryLoading, setCs408HistoryLoading] = useState(false);
  const [cs408Busy, setCs408Busy] = useState(false);
  const [cs408Loading, setCs408Loading] = useState(false);

  useEffect(() => {
    if (subject !== 'cs408' || cs408Years.length) return;
    void loadCs408Years();
  }, [subject]);
  useEffect(() => {
    if (!cs408Paper || cs408Paper.result) return;
    localStorage.setItem(`kaoyan-cs408-answers-${cs408Paper.id}`, JSON.stringify(cs408Answers));
  }, [cs408Paper?.id, cs408Answers]);
  useEffect(() => {
    if (subject !== 'cs408' || cs408View !== 'repair') return;
    void loadCs408Repair();
  }, [subject, cs408View, completedJobCount]);

  async function loadCs408Years() {
    setCs408Loading(true);
    try {
      const data = await request<{ items: Cs408Year[] }>('/api/cs408/papers');
      setCs408Years(data.items);
    } catch (e) { setError(e instanceof Error ? e.message : '408 试卷目录加载失败'); }
    finally { setCs408Loading(false); }
  }
  async function openCs408Year(year: number, restart = false) {
    setCs408Busy(true); setError('');
    try {
      const data = await request<Cs408Paper>('/api/cs408/papers', { method: 'POST', body: { year, restart } });
      setCs408Paper(data);
      if (data.result) {
        setCs408Answers(Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])));
      } else {
        const saved = localStorage.getItem(`kaoyan-cs408-answers-${data.id}`);
        setCs408Answers(saved ? JSON.parse(saved) : {});
      }
      setCs408PaperBack('papers');
      setCs408View('paper');
      window.scrollTo({ top: 0, behavior: 'instant' });
      void loadCs408Years();
    } catch (e) { setError(e instanceof Error ? e.message : '408 试卷加载失败'); }
    finally { setCs408Busy(false); }
  }
  async function startCs408Practice(nodeIds: string[], options: Cs408ComposeOptions) {
    if (options.source_mode !== 'real' && !aiSettings?.configured) { openSettings(); return; }
    setCs408Busy(true); setError('');
    try {
      if (options.source_mode === 'real') {
        const data = await request<Cs408Paper>('/api/cs408/practice', { method: 'POST', body: { node_ids: nodeIds, ...options } });
        setCs408Paper(data);
        setCs408Answers({});
        setCs408PaperBack('compose');
        setCs408View('paper');
        window.scrollTo({ top: 0, behavior: 'instant' });
      } else {
        const queued = await request<any>('/api/cs408/practice/ai', { method: 'POST', body: { node_ids: nodeIds, ...options } });
        const total = options.type_counts.single_choice + options.type_counts.free_response;
        onQueueJob({
          id: queued.job_id, status: 'queued', stage: queued.stage || '排队中', progress: queued.progress || 0,
          requestLabel: `408 ${options.source_mode === 'ai' ? 'AI 仿真' : '混合'} · ${total} 题`,
          detail: queued.detail, phase: queued.phase, expectedCount: queued.expected_count || total,
          generatedCount: 0, verifiedCount: 0, reusedCount: 0,
        });
      }
    } catch (e) { setError(e instanceof Error ? e.message : '408 练习卷生成失败'); }
    finally { setCs408Busy(false); }
  }
  async function loadCs408Repair() {
    setCs408RepairLoading(true);
    try {
      const data = await request<Cs408RepairPayload>('/api/cs408/repair/today');
      setCs408RepairCases(data.items);
      setCs408RepairDate(data.date);
      setCs408RepairBacklog(data.backlog_count);
      setCs408RepairCompleted(data.completed_count);
    } catch (e) { setError(e instanceof Error ? e.message : '408 修复队列加载失败'); }
    finally { setCs408RepairLoading(false); }
  }
  async function startCs408Repair(item: Cs408RepairCase) {
    if (!aiSettings?.configured) { openSettings(); return; }
    setCs408Busy(true); setError('');
    try {
      const data = await request<any>(`/api/cs408/repair/questions/${item.question_id}/generate`, { method: 'POST', body: {} });
      onQueueJob({
        id: data.job_id, status: 'queued', stage: data.stage || '排队中', progress: data.progress || 0,
        requestLabel: '408 AI 修复 · 3 道同章节变式', detail: data.detail || '正在准备 408 错因诊断…',
        phase: data.phase, expectedCount: data.expected_count || 3, generatedCount: 0, verifiedCount: 0, reusedCount: 0,
      });
      await loadCs408Repair();
    } catch (e) { setError(e instanceof Error ? e.message : '408 AI 修复启动失败'); }
    finally { setCs408Busy(false); }
  }
  async function openCs408RepairPaper(item: Cs408RepairCase) {
    if (!item.paper_id) return;
    setCs408Busy(true); setError('');
    try {
      const data = await request<Cs408Paper>(`/api/cs408/papers/${item.paper_id}`);
      setCs408Paper(data);
      setCs408Answers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {});
      setCs408PaperBack('repair');
      setCs408View('paper');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (e) { setError(e instanceof Error ? e.message : '408 修复卷加载失败'); }
    finally { setCs408Busy(false); }
  }
  async function loadCs408History() {
    setCs408HistoryLoading(true); setCs408View('history');
    try {
      const data = await request<{ items: Cs408HistoryItem[] }>('/api/cs408/history');
      setCs408History(data.items);
    } catch (e) { setError(e instanceof Error ? e.message : '408 试卷记录加载失败'); }
    finally { setCs408HistoryLoading(false); }
  }
  async function openCs408PaperById(id: string, back: 'history' | 'compose' | 'repair') {
    setCs408Busy(true); setError('');
    try {
      const data = await request<Cs408Paper>(`/api/cs408/papers/${id}`);
      setCs408Paper(data);
      setCs408Answers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {});
      setCs408PaperBack(back);
      setCs408View('paper');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (e) { setError(e instanceof Error ? e.message : '408 试卷加载失败'); }
    finally { setCs408Busy(false); }
  }
  async function openCs408JobPaper(paperId: string) {
    const data = await request<Cs408Paper>(`/api/cs408/papers/${paperId}`);
    setCs408Paper(data);
    setCs408Answers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {});
    setCs408PaperBack(data.origin === 'cs408_practice' ? 'compose' : data.origin === 'repair' ? 'repair' : 'papers');
    setCs408View('paper');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async function loadCs408Wrong() {
    setCs408Busy(true); setError('');
    try {
      const data = await request<{ items: Cs408WrongItem[] }>('/api/cs408/wrong-book');
      setCs408Wrong(data.items);
      setCs408View('wrong');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (e) { setError(e instanceof Error ? e.message : '408 错题本加载失败'); }
    finally { setCs408Busy(false); }
  }
  async function submitCs408() {
    if (!cs408Paper || cs408Busy) return;
    setCs408Busy(true); setError('');
    try {
      const answers = cs408Paper.items.map(item => ({
        question_id: item.question_id,
        answer_raw: cs408Answers[item.question_id] || '',
      }));
      const data = await request<Cs408Paper>(`/api/cs408/papers/${cs408Paper.id}/submit`, { method: 'POST', body: { answers } });
      setCs408Paper(data);
      void loadCs408Years();
      window.setTimeout(() => document.getElementById('cs408-result')?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (e) { setError(e instanceof Error ? e.message : '408 交卷失败'); }
    finally { setCs408Busy(false); }
  }
  function setCs408Answer(questionId: string, value: string) {
    setCs408Answers(current => ({ ...current, [questionId]: value }));
  }

  return {
    cs408View, setCs408View, cs408PaperBack, cs408Years, cs408Paper, cs408Answers,
    cs408Wrong, cs408RepairCases, cs408RepairDate, cs408RepairBacklog, cs408RepairCompleted,
    cs408RepairLoading, cs408History, cs408HistoryLoading,
    cs408Busy, cs408Loading,
    loadCs408Years, openCs408Year, startCs408Practice, loadCs408Repair, startCs408Repair,
    openCs408RepairPaper, loadCs408History, openCs408PaperById,
    loadCs408Wrong, submitCs408, setCs408Answer, openCs408JobPaper,
  };
}
