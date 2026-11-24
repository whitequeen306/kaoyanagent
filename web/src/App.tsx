import { useEffect, useMemo, useRef, useState } from 'react';
import { MathText } from './components/MathText';
import { MathBackdrop } from './components/MathBackdrop';
import { MathYearList } from './components/MathYearList';
import { PdfPaper } from './components/PdfPaper';
import { QuestionFigures } from './components/QuestionFigures';
import { AgentPanel } from './components/AgentPanel';
import { RepairPanel } from './components/RepairPanel';
import { DailyQuestionCard } from './components/DailyQuestionCard';
import { Cs408YearList } from './components/Cs408YearList';
import { Cs408Compose, type Cs408ComposeOptions } from './components/Cs408Compose';
import { Cs408RepairPanel } from './components/Cs408RepairPanel';
import { Cs408History } from './components/Cs408History';
import { Cs408Dashboard } from './components/Cs408Dashboard';
import { Cs408AgentPanel } from './components/Cs408AgentPanel';
import { Cs408PaperView } from './components/Cs408PaperView';
import { Cs408WrongBook } from './components/Cs408WrongBook';
import { pdfFileName, pickPdfDestination, savePdfElement } from './lib/pdf';
import { deviceId, difficultyLabel, formatScore, request } from './lib/api';
import type { Cs408HistoryItem, Cs408Metrics, Cs408Paper, Cs408RepairCase, Cs408RepairPayload, Cs408WrongItem, Cs408Year, DailyAnswerImage, DailyQuestionState, DailyWrongAnswer, Difficulty, GradeResult, Knowledge, MathExamYear, Paper, PaperMode, Qtype, RepairCase, SourceMode } from './types';

const qtypeOptions: { value: Qtype; label: string }[] = [
  { value: 'single_choice', label: '选择题' }, { value: 'fill_blank', label: '填空题' }, { value: 'free_response', label: '解答题' },
];
const sourceOptions: { value: SourceMode; label: string; note: string }[] = [
  { value: 'real', label: '真题', note: '从历年真题中抽题' },
  { value: 'ai', label: 'AI 仿真', note: '生成并校验新题' },
  { value: 'mixed', label: '混合', note: '目标真题与 AI 各半' },
];
const sampleStem = '设 $A=(\\alpha_1,\\alpha_2,\\alpha_3)$，其中 $\\alpha_1=(1,0,1)^T$。求矩阵 $A$ 的秩。';

type JobTask = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string;
  progress: number;
  requestLabel: string;
  detail?: string;
  phase?: string;
  expectedCount?: number;
  generatedCount?: number;
  verifiedCount?: number;
  reusedCount?: number;
  paper?: Paper;
  error?: string;
};
const jobPhaseIndex: Record<string, number> = { queued: -1, generating: 0, format_check: 1, self_test: 2, assembling: 3, done: 4 };
const MAX_ACTIVE_JOBS = 2;
const jobErrorMessages: Record<string, string> = {
  llm_not_configured: '无法连接模型，请确认已配置模型',
  llm_unreachable: '无法连接模型，请确认已配置模型',
  llm_upstream_error: '无法连接模型，请确认已配置模型',
  ai_generation_failed: '无法连接模型，请确认已配置模型',
  ai_blind_solve_mismatch: '生成题目未通过盲解校验，请重试。',
  ai_count_mismatch: '生成数量与要求不一致，请重试或减少题量。',
  ai_invalid_json: '模型返回格式异常，请重试。',
  ai_invalid_item: '模型生成的题目不完整，请重试。',
  ai_invalid_options: '生成的选择题选项不完整，请重试。',
  quota_exceeded: '今日生成额度已用完，请明天再试或使用真题。',
};
const qtypeLabel = (value: Qtype) => qtypeOptions.find(item => item.value === value)?.label || value;
const sourceLabel = (value: string) => sourceOptions.find(item => item.value === value)?.label || value;
const paperOriginKey = (paper: any) => paper.origin === 'repair' ? 'repair' : paper.origin === 'variant' ? 'variant' : paper.origin === 'math_exam' ? 'exam' : 'free';
const paperOriginLabel = (paper: any) => paperOriginKey(paper) === 'repair' ? '错题修复' : paperOriginKey(paper) === 'variant' ? '错题仿真' : paperOriginKey(paper) === 'exam' ? '真题整卷' : '自由练习';
const wrongRepairGroup = (item: any) => {
  if ((item.repair?.repair_passes || 0) >= 5 || item.repair?.status === 'completed') return 'mastered';
  if (['generating', 'ready', 'needs_retry', 'passed'].includes(item.repair?.status)) return 'repairing';
  return 'needs_repair';
};
const wrongPassBucket = (item: any) => {
  const passes = item.repair?.repair_passes || 0;
  if (passes === 0) return '0';
  if (passes <= 2) return '1-2';
  if (passes <= 4) return '3-4';
  return '5';
};

export default function App() {
  const [view, setView] = useState<'repair' | 'compose' | 'paper' | 'wrong' | 'papers' | 'examPapers' | 'metrics' | 'agent'>('compose');
  const [paperOrigin, setPaperOrigin] = useState<'compose' | 'papers' | 'repair' | 'exams'>('compose');
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [typeCounts, setTypeCounts] = useState<Record<Qtype, number>>({ single_choice: 2, fill_blank: 2, free_response: 1 });
  const [expanded, setExpanded] = useState<string[]>([]);
  const [source, setSource] = useState<SourceMode>('real');
  const [mode, setMode] = useState<PaperMode>('drill');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [paper, setPaper] = useState<Paper | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmedLatex, setConfirmedLatex] = useState<Record<string, string>>({});
  const [recognizing, setRecognizing] = useState<Record<string, boolean>>({});
  const [recognitionNotes, setRecognitionNotes] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [jobs, setJobs] = useState<JobTask[]>([]);
  const [jobsOpen, setJobsOpen] = useState(false);
  const startedJobs = useRef(new Set<string>());
  const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});
  const [recentPreview, setRecentPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [aiSettings, setAiSettings] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ base_url: '', api_key: '', model: '' });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [pdfPaper, setPdfPaper] = useState<Paper | null>(null);
  const [pdfChoiceOpen, setPdfChoiceOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfStage, setPdfStage] = useState<{ paper: Paper; includeAnswers: boolean } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMessage, setPdfMessage] = useState('');
  const [wrongItems, setWrongItems] = useState<any[]>([]);
  const [repairCases, setRepairCases] = useState<RepairCase[]>([]);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairDate, setRepairDate] = useState('');
  const [repairBacklogCount, setRepairBacklogCount] = useState(0);
  const dailyWrongTarget = useRef<string | null>(null);
  const [selectedWrong, setSelectedWrong] = useState<string[]>([]);
  const [variantCounts, setVariantCounts] = useState<Record<string, number>>({});
  const [myPapers, setMyPapers] = useState<any[]>([]);
  const [paperStatusFilter, setPaperStatusFilter] = useState('all');
  const [paperOriginFilter, setPaperOriginFilter] = useState('all');
  const [paperModeFilter, setPaperModeFilter] = useState('all');
  const [paperSourceFilter, setPaperSourceFilter] = useState('all');
  const [paperYearFilter, setPaperYearFilter] = useState('all');
  const [paperTimeFilter, setPaperTimeFilter] = useState('all');
  const [wrongStatusFilter, setWrongStatusFilter] = useState('all');
  const [wrongCauseFilter, setWrongCauseFilter] = useState('all');
  const [wrongSourceFilter, setWrongSourceFilter] = useState('all');
  const [wrongTypeFilter, setWrongTypeFilter] = useState('all');
  const [wrongYearFilter, setWrongYearFilter] = useState('all');
  const [wrongPassFilter, setWrongPassFilter] = useState('all');
  const [wrongKnowledgeFilter, setWrongKnowledgeFilter] = useState('all');
  const [metrics, setMetrics] = useState<any>(null);
  const [trends, setTrends] = useState<any[]>([]);
  const [mathExamYears, setMathExamYears] = useState<MathExamYear[]>([]);
  const [mathExamLoading, setMathExamLoading] = useState(false);
  const [showMathHelp, setShowMathHelp] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [dailyQuestion, setDailyQuestion] = useState<DailyQuestionState | null>(null);
  const [dailyAnswer, setDailyAnswer] = useState('');
  const [dailyAnswerImage, setDailyAnswerImage] = useState<DailyAnswerImage | null>(null);
  const [dailyError, setDailyError] = useState('');
  const [dailyReading, setDailyReading] = useState(false);
  const imageReadVersion = useRef(0);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyAiBusy, setDailyAiBusy] = useState(false);
  const [dailyAiPrompt, setDailyAiPrompt] = useState('');
  const [subject, setSubject] = useState<'math2' | 'cs408'>(() => localStorage.getItem('kaoyan-subject') === 'cs408' ? 'cs408' : 'math2');
  const [cs408View, setCs408View] = useState<'compose' | 'repair' | 'papers' | 'paper' | 'wrong' | 'history' | 'metrics' | 'agent'>('papers');
  const [cs408PaperBack, setCs408PaperBack] = useState<'compose' | 'repair' | 'papers' | 'history' | 'metrics'>('papers');
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
  const [cs408Metrics, setCs408Metrics] = useState<Cs408Metrics | null>(null);
  const [cs408MetricsLoading, setCs408MetricsLoading] = useState(false);
  const [cs408Busy, setCs408Busy] = useState(false);
  const [cs408Loading, setCs408Loading] = useState(false);

  useEffect(() => {
    if (!paper || result) return;
    const started = paper.created_at ? new Date(paper.created_at).getTime() : Date.now();
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [paper?.id, result]);

  useEffect(() => {
    request<{ items: Knowledge[] }>('/api/knowledge').then(data => {
      setKnowledge(data.items);
    }).catch(e => setError(`知识点加载失败：${e instanceof Error ? e.message : '未知错误'}`));
    request<any>('/api/ai-settings').then(setAiSettings).catch(() => {});
    void loadRepair();
    request<DailyQuestionState>('/api/daily-question').then(data => {
      setDailyQuestion(data);
      setDailyAnswer(data.result?.answer_raw ?? '');
      setDailyAnswerImage(null);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!paper) return;
    localStorage.setItem('kaoyan-paper-id', paper.id);
    localStorage.setItem(`kaoyan-answers-${paper.id}`, JSON.stringify(answers));
  }, [paper?.id, answers]);
  useEffect(() => {
    if (subject !== 'cs408' || cs408Years.length) return;
    void loadCs408Years();
  }, [subject]);
  useEffect(() => {
    if (!cs408Paper || cs408Paper.result) return;
    localStorage.setItem(`kaoyan-cs408-answers-${cs408Paper.id}`, JSON.stringify(cs408Answers));
  }, [cs408Paper?.id, cs408Answers]);
  const selectedNames = useMemo(() => knowledge.filter(n => selected.includes(n.id)).map(n => n.name), [knowledge, selected]);
  const totalCount = Object.values(typeCounts).reduce((sum, value) => sum + value, 0);
  const activeTypes = (Object.entries(typeCounts) as [Qtype, number][]).filter(([, value]) => value > 0);
  const mixedRealCount = Math.ceil(totalCount / 2);
  const mixedAiCount = totalCount - mixedRealCount;
  const searchResults = query ? knowledge.filter(n => n.name.includes(query) || n.aliases.some(a => a.includes(query))) : [];
  const subjects = knowledge.filter(n => n.level === 1);
  const attemptMap = useMemo(() => new Map(result?.attempts.map(a => [a.question_id, a]) || []), [result]);
  const answered = Object.values(answers).filter(Boolean).length;
  const activeJobCount = jobs.filter(task => task.status === 'running').length;
  const queuedJobCount = jobs.filter(task => task.status === 'queued').length;
  const completedJobCount = jobs.filter(task => task.status === 'succeeded').length;
  useEffect(() => {
    if (subject !== 'cs408' || cs408View !== 'repair') return;
    void loadCs408Repair();
  }, [subject, cs408View, completedJobCount]);
  const variantTotal = selectedWrong.reduce((sum, id) => sum + (variantCounts[id] || 3), 0);

  const paperYears = useMemo(() => [...new Set(myPapers.flatMap(paper => paper.years || []))].sort((a, b) => b - a), [myPapers]);
  const paperStatusCounts = useMemo(() => ({
    all: myPapers.length,
    draft: myPapers.filter(paper => paper.status !== 'submitted').length,
    submitted: myPapers.filter(paper => paper.status === 'submitted').length,
  }), [myPapers]);
  const filteredPapers = useMemo(() => myPapers.filter(paper => {
    if (paperStatusFilter !== 'all' && (paperStatusFilter === 'submitted' ? paper.status !== 'submitted' : paper.status === 'submitted')) return false;
    if (paperOriginFilter !== 'all' && paperOriginKey(paper) !== paperOriginFilter) return false;
    if (paperModeFilter !== 'all' && paper.mode !== paperModeFilter) return false;
    if (paperSourceFilter !== 'all' && paper.source_mode !== paperSourceFilter) return false;
    if (paperYearFilter !== 'all' && !(paper.years || []).includes(Number(paperYearFilter))) return false;
    if (paperTimeFilter !== 'all') {
      const days = (Date.now() - new Date(paper.created_at).getTime()) / 86400000;
      if (paperTimeFilter === '7' && days > 7) return false;
      if (paperTimeFilter === '30' && days > 30) return false;
      if (paperTimeFilter === 'older' && days <= 30) return false;
    }
    return true;
  }), [myPapers, paperStatusFilter, paperOriginFilter, paperModeFilter, paperSourceFilter, paperYearFilter, paperTimeFilter]);
  const wrongGroupCounts = useMemo(() => ({
    all: wrongItems.length,
    needs_repair: wrongItems.filter(item => wrongRepairGroup(item) === 'needs_repair').length,
    repairing: wrongItems.filter(item => wrongRepairGroup(item) === 'repairing').length,
    mastered: wrongItems.filter(item => wrongRepairGroup(item) === 'mastered').length,
  }), [wrongItems]);
  const wrongCauses = useMemo(() => [...new Set(wrongItems.flatMap(item => item.repair?.diagnosis?.cause_tags || []))], [wrongItems]);
  const wrongYears = useMemo(() => [...new Set(wrongItems.map(item => item.question?.year).filter(Boolean))].sort((a, b) => b - a), [wrongItems]);
  const wrongKnowledge = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of wrongItems) for (const node of item.knowledge || []) map.set(node.code, node.name);
    return [...map.entries()].map(([code, name]) => ({ code, name }));
  }, [wrongItems]);
  const filteredWrong = useMemo(() => wrongItems.filter(item => {
    if (wrongStatusFilter !== 'all' && wrongRepairGroup(item) !== wrongStatusFilter) return false;
    if (wrongCauseFilter !== 'all') {
      const causes = item.repair?.diagnosis?.cause_tags || [];
      if (wrongCauseFilter === 'none' ? causes.length > 0 : !causes.includes(wrongCauseFilter)) return false;
    }
    if (wrongSourceFilter !== 'all' && item.question?.source !== wrongSourceFilter) return false;
    if (wrongTypeFilter !== 'all' && item.question?.qtype !== wrongTypeFilter) return false;
    if (wrongYearFilter !== 'all' && item.question?.year !== Number(wrongYearFilter)) return false;
    if (wrongPassFilter !== 'all' && wrongPassBucket(item) !== wrongPassFilter) return false;
    if (wrongKnowledgeFilter !== 'all' && !(item.knowledge || []).some((node: any) => node.code === wrongKnowledgeFilter)) return false;
    return true;
  }), [wrongItems, wrongStatusFilter, wrongCauseFilter, wrongSourceFilter, wrongTypeFilter, wrongYearFilter, wrongPassFilter, wrongKnowledgeFilter]);
  const paperFiltersActive = [paperStatusFilter, paperOriginFilter, paperModeFilter, paperSourceFilter, paperYearFilter, paperTimeFilter].some(value => value !== 'all');
  const wrongFiltersActive = [wrongStatusFilter, wrongCauseFilter, wrongSourceFilter, wrongTypeFilter, wrongYearFilter, wrongPassFilter, wrongKnowledgeFilter].some(value => value !== 'all');

  useEffect(() => {
    if (view === 'repair') void loadRepair();
  }, [view, completedJobCount]);

  useEffect(() => {
    if (activeJobCount >= MAX_ACTIVE_JOBS) return;
    const next = jobs.find(task => task.status === 'queued' && !startedJobs.current.has(task.id));
    if (!next) return;
    startedJobs.current.add(next.id);
    void runJob(next.id);
  }, [jobs, activeJobCount]);

  function setTypeCount(type: Qtype, value: number) {
    const others = totalCount - typeCounts[type];
    const safe = Math.max(0, Math.min(30 - others, Number.isFinite(value) ? value : 0));
    setTypeCounts(current => ({ ...current, [type]: safe }));
  }
  function toggleExpanded(id: string) {
    setExpanded(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  }
  function toggleKnowledge(id: string) {
    setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  }
  function askCompose() {
    setError('');
    if (!selected.length) { setError('请先在左侧选择一个知识点，才能生成试卷。'); return; }
    if (totalCount < 1 || totalCount > 30) { setError('题量必须在 1 到 30 之间。'); return; }
    setConfirming(true);
  }
  function openSettings() {
    setSettingsForm(current => ({ base_url: aiSettings?.base_url || '', api_key: current.api_key || '', model: aiSettings?.model || '' }));
    setSettingsSuccess(false);
    setSettingsMessage(aiSettings?.configured ? '已保存配置，修改后需要重新测试。' : '支持 OpenAI 兼容接口，保存前会真实调用测试。');
    setSettingsOpen(true);
  }
  async function saveAiSettings() {
    setSettingsBusy(true);
    setSettingsSuccess(false);
    setSettingsMessage('正在测试模型连接…');
    try {
      const data = await request<any>('/api/ai-settings', { method: 'POST', body: settingsForm });
      setAiSettings(data.settings);
      setSettingsSuccess(true);
      setSettingsMessage(`连接正常（${data.latency_ms}ms），配置已保存。`);
    } catch (e) {
      setSettingsMessage(e instanceof Error ? e.message : '模型连接测试失败');
    } finally {
      setSettingsBusy(false);
    }
  }
  async function compose() {
    if (source !== 'real' && !aiSettings?.configured) {
      setError('无法连接模型，请确认已配置模型。');
      setConfirming(false);
      openSettings();
      return;
    }
    setBusy(true); setError(''); setConfirming(false);
    try {
      const type_counts = Object.fromEntries(activeTypes) as Record<string, number>;
      const body = { concept_node_ids: selected, qtypes: activeTypes.map(([type]) => type), type_counts, count: totalCount, source_mode: source, mode, difficulty };
      if (source !== 'real') {
        const queued = await request<any>('/api/papers/compose', { method: 'POST', body });
        setJobs(list => [...list, {
          id: queued.job_id, status: 'queued', stage: queued.stage || '排队中', progress: queued.progress || 0,
          requestLabel: `${sourceLabel(source)} · ${totalCount} 题`,
          detail: queued.detail, phase: queued.phase, expectedCount: queued.expected_count || 0,
          generatedCount: 0, verifiedCount: 0, reusedCount: queued.reused_count || 0,
        }]);
        setJobsOpen(true);
        return;
      }
      const data = await request<Paper>('/api/papers/compose', { method: 'POST', body });
      setPaperOrigin('compose');
      setPaper(data); setAnswers({}); setConfirmedLatex({}); setRecognitionNotes({}); setResult(null); setExpandedReviews({}); setElapsed(0); setView('paper');
    } catch (e) { setError(e instanceof Error ? e.message : '组卷失败'); }
    finally { setBusy(false); }
  }
  function applyJobSnapshot(id: string, current: any) {
    if (!current) return;
    setJobs(list => list.map(task => {
      if (task.id !== id || task.status === 'succeeded' || task.status === 'failed') return task;
      const status: JobTask['status'] = current.status === 'succeeded' ? 'succeeded' : current.status === 'failed' ? 'failed' : 'running';
      return {
        ...task, status,
        stage: current.stage || task.stage,
        progress: current.progress ?? task.progress,
        detail: current.detail || task.detail,
        phase: current.phase || task.phase,
        expectedCount: current.expected_count ?? task.expectedCount,
        generatedCount: current.generated_count ?? task.generatedCount,
        verifiedCount: current.verified_count ?? task.verifiedCount,
        reusedCount: current.reused_count ?? task.reusedCount,
        paper: current.paper || task.paper,
        error: current.error || undefined,
      };
    }));
  }
  async function runJob(id: string) {
    setJobs(list => list.map(task => task.id === id ? {
      ...task, status: 'running', stage: '生成题目', progress: 5,
      phase: 'generating', detail: '正在连接生成任务…',
    } : task));
    let finished = false;
    const poller = window.setInterval(async () => {
      if (finished) return;
      try {
        const snapshot = await request<any>(`/api/jobs/${id}`);
        applyJobSnapshot(id, snapshot);
      } catch {}
    }, 1200);
    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const current = await request<any>(`/api/jobs/${id}/step`, { method: 'POST', body: {} });
        applyJobSnapshot(id, current);
        if (current.status === 'succeeded' || current.status === 'failed') return;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('AI 生成超时，请重试。');
    } catch (e) {
      setJobs(list => list.map(task => task.id === id && task.status !== 'succeeded' ? {
        ...task, status: 'failed', stage: '失败',
        error: e instanceof Error ? e.message : '生成失败',
      } : task));
    } finally {
      finished = true;
      window.clearInterval(poller);
    }
  }
  async function openJobPaper(task: JobTask) {
    if (!task.paper) return;
    if ((task.paper as any).subject === 'cs408') {
      try {
        const data = await request<Cs408Paper>(`/api/cs408/papers/${task.paper.id}`);
        setSubject('cs408');
        localStorage.setItem('kaoyan-subject', 'cs408');
        setCs408Paper(data);
        setCs408Answers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {});
        setCs408PaperBack(data.origin === 'cs408_practice' ? 'compose' : data.origin === 'repair' ? 'repair' : 'papers');
        setCs408View('paper');
        setJobs(list => list.filter(item => item.id !== task.id));
        window.scrollTo({ top: 0, behavior: 'instant' });
      } catch (e) { setError(e instanceof Error ? e.message : '408 修复卷加载失败'); }
      return;
    }
    setPaperOrigin((task.paper as any).config_json?.origin === 'repair' ? 'repair' : 'compose');
    setPaper(task.paper); setAnswers({}); setConfirmedLatex({}); setRecognitionNotes({}); setResult(null); setExpandedReviews({}); setElapsed(0); setView('paper');
    setJobs(list => list.filter(item => item.id !== task.id));
  }
  function dismissJob(id: string) {
    setJobs(list => list.filter(item => item.id !== id));
  }
  async function openRecentPaper(id: string) {
    setPreviewLoading(true); setError('');
    try {
      const data = await request<any>(`/api/metrics/papers/${id}`);
      setRecentPreview(data);
    } catch (e) { setError(e instanceof Error ? e.message : '组卷详情加载失败'); }
    finally { setPreviewLoading(false); }
  }
  async function submit() {
    if (!paper) return;
    setBusy(true); setError('');
    try {
      const data = await request<GradeResult>(`/api/papers/${paper.id}/submit`, { method: 'POST', body: {
        answers: paper.items_json.map(item => ({
          question_id: item.question.id,
          answer_raw: answers[item.question.id] || '',
          confirmed_latex: confirmedLatex[item.question.id] || null,
          duration_sec: elapsed,
        })),
      } });
      setResult(data);
      if (paperOrigin === 'exams') void loadMathExamYears(false);
      setTimeout(() => document.getElementById('grade-result')?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) { setError(e instanceof Error ? e.message : '判卷失败'); }
    finally { setBusy(false); }
  }
  async function recognizeHandwriting(questionId: string, file: File) {
    if (!aiSettings?.configured) { openSettings(); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('只支持 PNG、JPG 或 WebP 图片。'); return; }
    if (!file.size || file.size > 4 * 1024 * 1024) { setError('图片需小于 4 MB。'); return; }
    setRecognizing(current => ({ ...current, [questionId]: true }));
    setError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      const asset = await request<{ image_asset_id: string }>('/api/assets', { method: 'POST', body: { mime_type: file.type, data_url: dataUrl } });
      const result = await request<{ recognized_latex: string; confidence: number; needs_confirmation: boolean }>('/api/recognition', {
        method: 'POST', body: { image_asset_id: asset.image_asset_id, question_id: questionId },
      });
      setAnswers(current => ({ ...current, [questionId]: result.recognized_latex }));
      setConfirmedLatex(current => ({ ...current, [questionId]: result.recognized_latex }));
      setRecognitionNotes(current => ({ ...current, [questionId]: `识别置信度 ${result.confidence}%${result.needs_confirmation ? '，请核对后再交卷' : ''}` }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '手写识别失败');
    } finally {
      setRecognizing(current => ({ ...current, [questionId]: false }));
    }
  }
  function selectDailyImage(file: File) {
    if (dailyBusy) return;
    const version = ++imageReadVersion.current;
    setDailyAnswerImage(null);
    setDailyReading(false);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setDailyError('只支持 PNG、JPG 或 WebP 图片。'); return; }
    if (!file.size || file.size > 4 * 1024 * 1024) { setDailyError('请选择非空且不超过 4 MB 的图片。'); return; }
    setDailyError('');
    setDailyReading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (version !== imageReadVersion.current) return;
      setDailyReading(false);
      if (reader.error || typeof reader.result !== 'string') { setDailyError('图片读取失败，请重新选择。'); return; }
      setDailyAnswerImage({ mime_type: file.type as DailyAnswerImage['mime_type'], data_url: reader.result, name: file.name });
    };
    reader.readAsDataURL(file);
  }
  async function submitDaily() {
    if (!dailyQuestion || dailyBusy || dailyReading || (!dailyAnswer.trim() && !dailyAnswerImage)) return;
    setDailyBusy(true); setDailyError('');
    try {
      const data = await request<DailyQuestionState>('/api/daily-question/submit', { method: 'POST', body: {
        date: dailyQuestion.date, question_id: dailyQuestion.question.id,
        answer_raw: dailyAnswer,
        answer_image: dailyAnswerImage ? { mime_type: dailyAnswerImage.mime_type, data_url: dailyAnswerImage.data_url } : undefined,
      } });
      setDailyQuestion(data);
      if (data.status === 'submitted' && !data.result?.retryable) setDailyAnswerImage(null);
    } catch (e) { setDailyError(e instanceof Error ? e.message : '每日题判定失败，请重试。'); }
    finally { setDailyBusy(false); }
  }
  async function askDailyAi(prompt: string) {
    if (!dailyQuestion) return;
    setDailyAiBusy(true); setError('');
    try {
      const data = await request<DailyQuestionState>('/api/daily-question/explain', { method: 'POST', body: { date: dailyQuestion.date, prompt } });
      setDailyQuestion(data);
      setDailyAiPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 讲解失败');
      if (!aiSettings?.configured) openSettings();
    } finally { setDailyAiBusy(false); }
  }
  useEffect(() => {
    const target = dailyWrongTarget.current;
    if (view !== 'wrong' || !target) return;
    const card = document.getElementById(`wrong-${target}`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'start', behavior: 'instant' });
    dailyWrongTarget.current = null;
  }, [view]);
  async function loadRepair() {
    setRepairLoading(true);
    try {
      const data = await request<{ items: RepairCase[]; date: string; backlog_count: number }>('/api/repair/today');
      setRepairCases(data.items);
      setRepairDate(data.date);
      setRepairBacklogCount(data.backlog_count);
    } catch (e) { setError(e instanceof Error ? e.message : '修复队列加载失败'); }
    finally { setRepairLoading(false); }
  }
  async function startRepair(questionId: string) {
    if (!aiSettings?.configured) { openSettings(); return; }
    setError('');
    try {
      const data = await request<any>(`/api/repair/questions/${questionId}/generate`, { method: 'POST', body: {} });
      setJobs(list => [...list, {
        id: data.job_id, status: 'queued', stage: data.stage || '排队中', progress: data.progress || 0,
        requestLabel: 'AI 修复 · 错因诊断与定向变式', detail: data.detail || '正在准备 AI 修复…',
        phase: data.phase, expectedCount: data.expected_count || 3, generatedCount: 0, verifiedCount: 0, reusedCount: 0,
      }]);
      setJobsOpen(true);
      await loadRepair();
    } catch (e) { setError(e instanceof Error ? e.message : 'AI 修复启动失败'); }
  }
  async function replaceRepair(questionId: string) {
    setBusy(true); setError('');
    try {
      const data = await request<any>('/api/repair/today/replace', { method: 'POST', body: { question_id: questionId } });
      setRepairCases(data.items);
      setRepairDate(data.date);
      setRepairBacklogCount(data.backlog_count);
    } catch (e) { setError(e instanceof Error ? e.message : '替换错题失败'); }
    finally { setBusy(false); }
  }
  async function openRepairPaper(item: RepairCase) {
    if (!item.paper_id) return;
    setBusy(true); setError('');
    try {
      const data = await request<Paper>(`/api/papers/${item.paper_id}`);
      setPaper(data); setPaperOrigin('repair');
      setAnswers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {});
      setResult(data.result || null); setExpandedReviews({}); setElapsed(0); setView('paper');
    } catch (e) { setError(e instanceof Error ? e.message : '修复卷加载失败'); }
    finally { setBusy(false); }
  }
  async function loadWrong() {
    setBusy(true); setError('');
    try {
      const data = await request<{ items: any[] }>('/api/wrong-book');
      setWrongItems(data.items);
      setSelectedWrong(current => current.filter(id => data.items.some(item => item.question_id === id)));
      setView('wrong');
    }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } finally { setBusy(false); }
  }
  function variantCountFor(id: string) {
    return variantCounts[id] || 3;
  }
  function toggleWrongSelection(id: string) {
    setSelectedWrong(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    setVariantCounts(current => current[id] ? current : { ...current, [id]: 3 });
  }
  function setVariantCount(id: string, value: number) {
    const safe = Math.max(3, Math.min(10, Number.isFinite(value) ? value : 3));
    setVariantCounts(current => ({ ...current, [id]: safe }));
  }
  async function composeVariants() {
    if (!selectedWrong.length) { setError('请先勾选需要练习的错题。'); return; }
    if (variantTotal > 30) { setError('仿真题合计不能超过 30 道，请减少错题或每题数量。'); return; }
    if (!aiSettings?.configured) {
      setError('无法连接模型，请确认已配置模型。');
      openSettings();
      return;
    }
    setBusy(true); setError('');
    try {
      const items = selectedWrong.map(id => ({ question_id: id, count: variantCountFor(id) }));
      const queued = await request<any>('/api/variants', { method: 'POST', body: { items } });
      setJobs(list => [...list, {
        id: queued.job_id, status: 'queued', stage: queued.stage || '排队中', progress: queued.progress || 0,
        requestLabel: `错题仿真 · ${selectedWrong.length} 道错题 / ${variantTotal} 题`,
        detail: queued.detail, phase: queued.phase, expectedCount: queued.expected_count || variantTotal,
        generatedCount: 0, verifiedCount: 0,
      }]);
      setJobsOpen(true);
      setSelectedWrong([]);
      setVariantCounts({});
    } catch (e) { setError(e instanceof Error ? e.message : '仿真卷生成失败'); }
    finally { setBusy(false); }
  }
  async function deleteWrong(id: string) {
    setBusy(true); setError('');
    try {
      await request(`/api/wrong-book/${id}`, { method: 'DELETE' });
      setWrongItems(list => list.filter(item => item.question_id !== id));
      setSelectedWrong(current => current.filter(item => item !== id));
    } catch (e) { setError(e instanceof Error ? e.message : '移出错题本失败'); }
    finally { setBusy(false); }
  }
  async function loadMyPapers() {
    setBusy(true); setError('');
    try { const data = await request<{ items: any[] }>('/api/papers'); setMyPapers(data.items); setView('papers'); }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } finally { setBusy(false); }
  }
  async function openPdfOptions(id: string) {
    setPdfLoading(true); setError('');
    try {
      const data = await request<Paper>(`/api/papers/${id}`);
      setPdfPaper(data);
      setPdfChoiceOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : '读取试卷失败'); }
    finally { setPdfLoading(false); }
  }
  async function generatePaperPdf(paper: Paper, includeAnswers: boolean, fileHandle: any, fileName: string) {
    setPdfChoiceOpen(false);
    setPdfBusy(true);
    setPdfMessage('正在生成 PDF…');
    setPdfStage({ paper, includeAnswers });
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const element = document.getElementById('pdf-export-paper');
      if (!element) throw new Error('PDF 内容未就绪');
      const method = await savePdfElement(element, fileHandle, fileName);
      setPdfMessage(method === 'picker' ? 'PDF 已保存。' : '当前浏览器不支持选择保存位置，已下载到默认下载目录。');
      window.setTimeout(() => { setPdfBusy(false); setPdfStage(null); }, 900);
    } catch (e) {
      setPdfBusy(false);
      setPdfStage(null);
      setError(e instanceof Error ? `PDF 生成失败：${e.message}` : 'PDF 生成失败');
    }
  }
  async function savePaperPdf(paper: Paper, includeAnswers: boolean) {
    const fileName = pdfFileName(paper, includeAnswers);
    let fileHandle: any = null;
    try {
      fileHandle = await pickPdfDestination(fileName);
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return;
      setError('无法打开保存位置选择器，已取消导出。');
      return;
    }
    await generatePaperPdf(paper, includeAnswers, fileHandle, fileName);
  }
  async function saveDraftPdfDirect(summary: any) {
    const fileName = pdfFileName({ ...summary, title: summary.title || '数学二练习卷' } as Paper, false);
    let fileHandle: any = null;
    try {
      fileHandle = await pickPdfDestination(fileName);
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return;
      setError('无法打开保存位置选择器，已取消导出。');
      return;
    }
    setPdfLoading(true);
    try {
      const paper = await request<Paper>(`/api/papers/${summary.id}`);
      setPdfLoading(false);
      await generatePaperPdf(paper, false, fileHandle, fileName);
    } catch (e) {
      setPdfLoading(false);
      setError(e instanceof Error ? e.message : '读取试卷失败');
    }
  }
  async function openMyPaper(id: string) {
    setBusy(true); setError('');
    try {
      const data = await request<Paper>(`/api/papers/${id}`);
      setPaper(data);
      if (data.result) {
        setAnswers(Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || '']))); setConfirmedLatex({}); setRecognitionNotes({});
        setResult(data.result);
      } else {
        const saved = localStorage.getItem(`kaoyan-answers-${data.id}`);
        setAnswers(saved ? JSON.parse(saved) : {}); setConfirmedLatex({}); setRecognitionNotes({});
        setResult(null);
      }
      setExpandedReviews({});
      setElapsed(0);
      setPaperOrigin('papers');
      setView('paper');
    } catch (e) { setError(e instanceof Error ? e.message : '加载试卷失败'); }
    finally { setBusy(false); }
  }
  async function loadMetrics() {
    setBusy(true); setError('');
    try {
      const [current, trend] = await Promise.all([request<any>('/api/metrics/current'), request<any>('/api/metrics/trends')]);
      setMetrics(current); setTrends(trend.series); setView('metrics');
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } finally { setBusy(false); }
  }
  async function loadMathExamYears(navigate = true) {
    setMathExamLoading(true);
    if (navigate) setView('examPapers');
    try {
      const data = await request<{ items: MathExamYear[] }>('/api/math/exam-years');
      setMathExamYears(data.items);
    } catch (e) { setError(e instanceof Error ? e.message : '数学真题目录加载失败'); }
    finally { setMathExamLoading(false); }
  }
  async function openMathExamYear(year: number, restart = false) {
    setBusy(true); setError('');
    try {
      const created = await request<Paper>('/api/math/exam-papers', { method: 'POST', body: { year, restart } });
      const data = await request<Paper>(`/api/papers/${created.id}`);
      setPaper(data);
      if (data.result) {
        setAnswers(Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || '']))); setConfirmedLatex({}); setRecognitionNotes({});
        setResult(data.result);
      } else {
        const saved = localStorage.getItem(`kaoyan-answers-${data.id}`);
        setAnswers(saved ? JSON.parse(saved) : {}); setConfirmedLatex({}); setRecognitionNotes({});
        setResult(null);
      }
      setExpandedReviews({});
      setElapsed(0);
      setPaperOrigin('exams');
      setView('paper');
      window.scrollTo({ top: 0, behavior: 'instant' });
      void loadMathExamYears(false);
    } catch (e) { setError(e instanceof Error ? e.message : '数学真题卷加载失败'); }
    finally { setBusy(false); }
  }

  function switchSubject(next: 'math2' | 'cs408') {
    setSubject(next);
    localStorage.setItem('kaoyan-subject', next);
    if (next === 'cs408') setCs408View('papers');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
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
        setJobs(list => [...list, {
          id: queued.job_id, status: 'queued', stage: queued.stage || '排队中', progress: queued.progress || 0,
          requestLabel: `408 ${sourceLabel(options.source_mode)} · ${total} 题`,
          detail: queued.detail, phase: queued.phase, expectedCount: queued.expected_count || total,
          generatedCount: 0, verifiedCount: 0, reusedCount: 0,
        }]);
        setJobsOpen(true);
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
      setJobs(list => [...list, {
        id: data.job_id, status: 'queued', stage: data.stage || '排队中', progress: data.progress || 0,
        requestLabel: '408 AI 修复 · 3 道同章节变式', detail: data.detail || '正在准备 408 错因诊断…',
        phase: data.phase, expectedCount: data.expected_count || 3, generatedCount: 0, verifiedCount: 0, reusedCount: 0,
      }]);
      setJobsOpen(true);
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
  async function loadCs408Metrics() {
    setCs408MetricsLoading(true); setCs408View('metrics');
    try {
      setCs408Metrics(await request<Cs408Metrics>('/api/cs408/metrics'));
    } catch (e) { setError(e instanceof Error ? e.message : '408 数据中心加载失败'); }
    finally { setCs408MetricsLoading(false); }
  }
  async function openCs408PaperById(id: string, back: 'history' | 'metrics') {
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

  return <div className="app-shell">
    <MathBackdrop subject={subject} />
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {recentPreview && <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="组卷详情" onClick={() => setRecentPreview(null)}><div className="preview-card" onClick={event => event.stopPropagation()}>
      <div className="preview-head"><div><span className="eyebrow">公开组卷预览</span><h2>{recentPreview.concepts?.map((node: any) => node.name).slice(0, 3).join(' · ') || '综合练习'}</h2><p>{recentPreview.mode === 'exam' ? '整卷模考' : '专项突破'} · {sourceLabel(recentPreview.source_mode)} · {recentPreview.items.length} 题 · {formatScore(recentPreview.total_score_x2)} 分</p></div><button className="preview-close" onClick={() => setRecentPreview(null)}>关闭</button></div>
      <p className="preview-note">{recentPreview.note}</p>
      <div className="preview-items">{recentPreview.items.map((item: any, index: number) => <article className="preview-item" key={item.question.id}>
        <div className="question-meta"><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className={`source-tag ${item.question.source}`}>{item.question.source === 'real' ? `${item.question.year || '历年'} 真题` : 'AI 原创'}</span><span>{qtypeLabel(item.question.qtype)}</span><span>{formatScore(item.score_x2)} 分</span></div>
        <div className="stem"><MathText text={item.question.stem_latex} /></div>
        <QuestionFigures assets={item.question.figure_assets} />
        {item.question.options_json?.length ? <div className="preview-options">{item.question.options_json.map((option: any) => <div className="preview-option" key={option.label}><b>{option.label}</b><MathText text={option.latex} /></div>)}</div> : null}
      </article>)}</div>
    </div></div>}
    {previewLoading && <div className="preview-loading no-print">正在加载组卷详情…</div>}
    {settingsOpen && <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="模型设置" onClick={() => { if (!settingsBusy) setSettingsOpen(false); }}><div className="settings-card" onClick={event => event.stopPropagation()}>
      <span className="eyebrow">模型服务</span><h2>配置模型提供商</h2>
      <p>支持 OpenAI 兼容接口。Base URL 填到 <code>/v1</code>，例如 <code>https://api.openai.com/v1</code>。API Key 只保存在服务端，不会回传浏览器。</p>
      <div className="settings-fields">
        <label>Base URL<input value={settingsForm.base_url} onChange={event => setSettingsForm(current => ({ ...current, base_url: event.target.value }))} placeholder="https://api.openai.com/v1" /></label>
        <label>API Key<input type="password" value={settingsForm.api_key} onChange={event => setSettingsForm(current => ({ ...current, api_key: event.target.value }))} placeholder={aiSettings?.has_key ? `已保存 ${aiSettings.key_hint}，留空不修改` : 'sk-...'} /></label>
        <label>模型<input value={settingsForm.model} onChange={event => setSettingsForm(current => ({ ...current, model: event.target.value }))} placeholder="gpt-4o-mini / deepseek-chat" /></label>
      </div>
      {settingsMessage && <div className={`settings-status ${settingsSuccess ? 'success' : ''}`}>{settingsMessage}</div>}
      <div className="modal-actions"><button onClick={() => setSettingsOpen(false)} disabled={settingsBusy}>关闭</button><button className="primary" onClick={saveAiSettings} disabled={settingsBusy}>{settingsBusy ? '正在测试…' : '保存并测试'}</button></div>
    </div></div>}
    {pdfLoading && <div className="preview-loading no-print">正在读取试卷…</div>}
    {pdfChoiceOpen && pdfPaper && <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="保存为 PDF" onClick={() => { if (!pdfBusy) setPdfChoiceOpen(false); }}><div className="pdf-choice-card" onClick={event => event.stopPropagation()}>
      <span className="eyebrow">导出试卷</span><h2>保存为 PDF</h2>
      <p>{pdfPaper.title || '数学二练习卷'} · {pdfPaper.items_json.length} 题 · {pdfPaper.status === 'submitted' ? '已交卷' : '待完成'}</p>
      <p className="pdf-hint">保存窗口默认打开桌面，也可以在选择窗口中更换位置。</p>
      {pdfPaper.status === 'submitted' ? <div className="pdf-choice-options">
        <button className="pdf-choice-option" onClick={() => savePaperPdf(pdfPaper, true)}><strong>带作答与解析</strong><small>保留你的作答、正确答案和解析，适合复盘。</small></button>
        <button className="pdf-choice-option" onClick={() => savePaperPdf(pdfPaper, false)}><strong>空白卷</strong><small>不含作答痕迹，适合重新练习。</small></button>
      </div> : <button className="primary" onClick={() => savePaperPdf(pdfPaper, false)}>保存空白卷 PDF</button>}
      <div className="modal-actions"><button onClick={() => setPdfChoiceOpen(false)} disabled={pdfBusy}>取消</button></div>
    </div></div>}
    {pdfStage && <div className="pdf-export-overlay"><div className="pdf-export-status">{pdfMessage}</div><div className="pdf-export-scroll"><PdfPaper paper={pdfStage.paper} includeAnswers={pdfStage.includeAnswers} /></div></div>}
    {confirming && <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="确认组卷"><div className="confirm-card"><span className="eyebrow">生成前确认</span><h2>按这个配置出卷？</h2><dl><div><dt>知识块</dt><dd>{selectedNames.join('、')}</dd></div><div><dt>模式</dt><dd>{mode === 'exam' ? '整卷模考 · 易中难梯度' : '专项突破 · 同档集中练习'}</dd></div><div><dt>题源</dt><dd>{sourceOptions.find(s => s.value === source)?.label} · 共 {totalCount} 题{source === 'mixed' ? `（真题 ${mixedRealCount} / AI ${mixedAiCount}）` : ''}</dd></div><div><dt>题型</dt><dd>选择 {typeCounts.single_choice} · 填空 {typeCounts.fill_blank} · 解答 {typeCounts.free_response}</dd></div><div><dt>难度</dt><dd>{difficultyLabel(difficulty)}</dd></div></dl><p>{source === 'real' ? '试卷生成后会固定题序和题目版本，作答记录可回看。' : 'AI 出卷在后台进行，完成后会在右下角通知；期间你可以继续组下一张卷。'}</p><div className="modal-actions"><button onClick={() => setConfirming(false)}>返回修改</button><button className="primary" onClick={compose}>确认并生成</button></div></div></div>}
    <header className="topbar no-print">
      <button className="brand" onClick={() => { if (subject === 'cs408') setCs408View('papers'); else { setView('compose'); setResult(null); } }}>
        <span className={`brand-mark ${subject === 'cs408' ? 'cs408-mark' : ''}`}>{subject === 'cs408' ? '408' : '∑'}</span><span><strong>题脉</strong><small>{subject === 'cs408' ? '考研 408 · 真题练习' : '考研数学二 · 智能练习'}</small></span>
      </button>
      <div className="subject-switch" role="tablist" aria-label="科目切换">
        <button role="tab" aria-selected={subject === 'math2'} className={subject === 'math2' ? 'active' : ''} onClick={() => switchSubject('math2')}>数学二</button>
        <button role="tab" aria-selected={subject === 'cs408'} className={subject === 'cs408' ? 'active' : ''} onClick={() => switchSubject('cs408')}>408</button>
      </div>
      <nav aria-label="主导航">
        {subject === 'math2' ? <>
          <button className={view === 'compose' ? 'active' : ''} aria-current={view === 'compose' ? 'page' : undefined} onClick={() => setView('compose')}>自由练习</button>
          <button className={view === 'examPapers' ? 'active' : ''} aria-current={view === 'examPapers' ? 'page' : undefined} onClick={() => { window.scrollTo({ top: 0, behavior: 'instant' }); void loadMathExamYears(); }}>真题试卷</button>
          <button className={view === 'repair' ? 'active' : ''} aria-current={view === 'repair' ? 'page' : undefined} onClick={() => { void loadRepair(); setView('repair'); }}>今日修复</button>
          <button className={view === 'wrong' ? 'active' : ''} aria-current={view === 'wrong' ? 'page' : undefined} onClick={loadWrong}>错题本</button>
          <button className={view === 'papers' ? 'active' : ''} aria-current={view === 'papers' ? 'page' : undefined} onClick={loadMyPapers}>我的试卷</button>
          <button className={view === 'metrics' ? 'active' : ''} aria-current={view === 'metrics' ? 'page' : undefined} onClick={loadMetrics}>数据中心</button>
          <button className={view === 'agent' ? 'active' : ''} aria-current={view === 'agent' ? 'page' : undefined} onClick={() => setView('agent')}>学习助手</button>
          <button onClick={openSettings}>模型设置</button>
        </> : <>
          <button className={cs408View === 'compose' ? 'active' : ''} aria-current={cs408View === 'compose' ? 'page' : undefined} onClick={() => { setCs408View('compose'); window.scrollTo({ top: 0, behavior: 'instant' }); }}>自由练习</button>
          <button className={cs408View === 'repair' ? 'active' : ''} aria-current={cs408View === 'repair' ? 'page' : undefined} onClick={() => { setCs408View('repair'); window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408Repair(); }}>今日修复</button>
          <button className={cs408View === 'papers' ? 'active' : ''} aria-current={cs408View === 'papers' ? 'page' : undefined} onClick={() => { setCs408View('papers'); window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408Years(); }}>真题试卷</button>
          <button className={cs408View === 'history' ? 'active' : ''} aria-current={cs408View === 'history' ? 'page' : undefined} onClick={() => { window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408History(); }}>我的试卷</button>
          <button className={cs408View === 'wrong' ? 'active' : ''} aria-current={cs408View === 'wrong' ? 'page' : undefined} onClick={loadCs408Wrong}>错题本</button>
          <button className={cs408View === 'metrics' ? 'active' : ''} aria-current={cs408View === 'metrics' ? 'page' : undefined} onClick={() => { window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408Metrics(); }}>数据中心</button>
          <button className={cs408View === 'agent' ? 'active' : ''} aria-current={cs408View === 'agent' ? 'page' : undefined} onClick={() => { setCs408View('agent'); window.scrollTo({ top: 0, behavior: 'instant' }); }}>学习助手</button>
          <button onClick={openSettings}>模型设置</button>
        </>}
      </nav>
    </header>
    <main id="main-content" tabIndex={-1}>
      {error && <div className="error-banner no-print" role="alert">{error}<button onClick={() => setError('')}>知道了</button></div>}
      {subject === 'math2' && <>
      {view === 'repair' && <RepairPanel
        cases={repairCases}
        loading={repairLoading}
        busy={busy}
        date={repairDate}
        backlogCount={repairBacklogCount}
        aiConfigured={Boolean(aiSettings?.configured)}
        onOpenSettings={openSettings}
        onOpenWrong={loadWrong}
        onStart={item => startRepair(item.question_id)}
        onOpenPaper={openRepairPaper}
        onReplace={item => replaceRepair(item.question_id)}
        onOpenPractice={() => setView('compose')}
        onRefresh={() => void loadRepair()}
      />}
      {view === 'compose' && <>
        <section className="intro no-print">
          <h1>自由练习组卷</h1>
          <p>想额外刷题时，再按知识点自由组卷；错题会自动进入「今日修复」。</p>
        </section>
        {dailyQuestion && <DailyQuestionCard
          daily={dailyQuestion}
          answer={dailyAnswer}
          answerImage={dailyAnswerImage}
          busy={dailyBusy}
          reading={dailyReading}
          error={dailyError}
          modelConfigured={Boolean(aiSettings?.configured)}
          onSettings={openSettings}
          onWrong={() => { dailyWrongTarget.current = dailyQuestion.question.id; void loadWrong(); }}
          aiBusy={dailyAiBusy}
          aiPrompt={dailyAiPrompt}
          onAnswerChange={setDailyAnswer}
          onImageSelect={selectDailyImage}
          onImageRemove={() => setDailyAnswerImage(null)}
          onSubmit={submitDaily}
          onAiPromptChange={setDailyAiPrompt}
          onAiAsk={askDailyAi}
        />}
        <div className="compose-layout no-print">
          <section className="panel knowledge-panel">
            <div className="section-heading"><span>01</span><div><h2>选择知识点</h2><p>支持多选，选择章节会包含其下全部考点。</p></div></div>
            <label className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="试试：极限、二重积分、微分方程" /></label>
            {query ? <div className="knowledge-grid search-live">{searchResults.map(node => <button key={node.id} className={`knowledge-chip ${selected.includes(node.id) ? 'selected' : ''}`} onClick={() => toggleKnowledge(node.id)}>
              <span className="chip-dot" />{node.name}<small>{node.level === 1 ? '整门' : node.level === 2 ? '章节' : '考点'}</small>
            </button>)}{!searchResults.length && <div className="empty-state">没有匹配的知识点</div>}</div> : <div className="knowledge-tree">{subjects.map(subject => <div className="tree-subject" key={subject.id}>
              <button className={`knowledge-chip subject-chip ${selected.includes(subject.id) ? 'selected' : ''}`} onClick={() => toggleKnowledge(subject.id)}><span className="chip-dot" />{subject.name}<small>整门</small></button>
              <div className="tree-chapters">{knowledge.filter(n => n.parent_id === subject.id && n.level === 2).map(chapter => <div className="chapter-block" key={chapter.id}>
                <button className={`knowledge-chip chapter-chip ${selected.includes(chapter.id) ? 'selected' : ''}`} onClick={() => { toggleKnowledge(chapter.id); toggleExpanded(chapter.id); }}>
                  <span className="chip-dot" />{chapter.name}<span className="expand-mark">{expanded.includes(chapter.id) ? '−' : '+'}</span>
                </button>
                {expanded.includes(chapter.id) && <div className="leaf-list">{knowledge.filter(n => n.parent_id === chapter.id && n.level === 3).map(leaf =>
                  <button key={leaf.id} className={`knowledge-chip leaf-chip ${selected.includes(leaf.id) ? 'selected' : ''}`} onClick={() => toggleKnowledge(leaf.id)}>{leaf.name}</button>)}
                </div>}
              </div>)}</div>
            </div>)}</div>}
            {!knowledge.length && <div className="empty-state">正在加载知识点…</div>}
          </section>
          <section className="panel settings-panel">
            <div className="settings-scroll">
            <div className="section-heading"><span>02</span><div><h2>设定这张卷</h2><p>你可以随时调整。</p></div></div>
            <div className="field"><label>组卷模式</label><div className="segmented two"><button className={mode === 'exam' ? 'active' : ''} onClick={() => setMode('exam')}>整卷模考<small>易 → 中 → 难梯度</small></button><button className={mode === 'drill' ? 'active' : ''} onClick={() => setMode('drill')}>专项突破<small>同档集中练习</small></button></div></div>
            <div className="field"><label>题源</label><div className="source-options">{sourceOptions.map(item => <button key={item.value} className={source === item.value ? 'active' : ''} onClick={() => setSource(item.value)}><strong>{item.label}</strong><small>{item.value === 'real' ? item.note : item.value === 'mixed' ? `真题与 AI 各半，奇数时真题多 1 道（本卷 ${mixedRealCount} + ${mixedAiCount}）` : '后台生成约 10–60 秒，完成后右下角通知'}</small></button>)}</div></div>
            {source !== 'real' && <div className={`ai-provider-status ${aiSettings?.configured ? 'ok' : ''}`}><span>{aiSettings?.configured ? `模型：${aiSettings.model}` : '尚未配置模型服务，AI 出卷不可用'}</span><button onClick={openSettings}>{aiSettings?.configured ? '修改' : '去配置'}</button></div>}
            <div className="field"><label>题型与题量 <small>合计 {totalCount} / 30</small></label><div className="type-counts">{qtypeOptions.map(item => <div className="type-count-row" key={item.value}><span>{item.label}</span><div className="number-input compact"><button onClick={() => setTypeCount(item.value, typeCounts[item.value] - 1)}>−</button><input type="number" min={0} max={30} value={typeCounts[item.value]} onChange={e => setTypeCount(item.value, Number(e.target.value))} /><button onClick={() => setTypeCount(item.value, typeCounts[item.value] + 1)}>+</button></div></div>)}</div>{totalCount > 30 && <div className="field-error">题量合计不能超过 30。</div>}</div>
            <div className="field"><label>难度</label><div className="difficulty-row">{(['easy', 'medium', 'hard'] as Difficulty[]).map(d => <button key={d} className={difficulty === d ? 'active' : ''} onClick={() => setDifficulty(d)}>{difficultyLabel(d)}</button>)}</div></div>
            {!selected.length && <div className="compose-hint">请先在左侧选择知识点，才能生成试卷。</div>}
            </div>
            <div className="summary"><span>{selected.length ? `已选 ${selected.length} 个知识块` : '尚未选择知识点'} · {totalCount} 题</span><button className="primary" disabled={busy || !selected.length || totalCount < 1 || totalCount > 30} onClick={askCompose}>{busy ? (source === 'real' ? '正在组卷…' : '正在加入队列…') : source === 'real' ? '生成试卷 →' : '加入出卷队列 →'}</button></div>
          </section>
        </div>
      </>}
      {view === 'examPapers' && <MathYearList years={mathExamYears} loading={mathExamLoading} busy={busy} onOpen={openMathExamYear} />}
      {view === 'paper' && paper && <>
        <div className="paper-toolbar no-print"><button className="back" onClick={() => setView(paperOrigin === 'exams' ? 'examPapers' : paperOrigin)}>← {paperOrigin === 'papers' ? '我的试卷' : paperOrigin === 'repair' ? '今日修复' : paperOrigin === 'exams' ? '真题试卷' : '自由练习'}</button></div>
        <section className="paper-head">
          <span className="eyebrow">{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</span>
          <h1>{paper.title || (paper.origin === 'variant' ? '错题仿真练习' : selectedNames.join(' · ')) || '数学二练习卷'}</h1>
          <p>{paper.items_json.length} 题 · 卷面 {formatScore(paper.total_score_x2)} 分 · {paper.actual_ratio.real} 道真题 / {paper.actual_ratio.ai} 道 AI 原创</p>
          <details className="paper-notes">
            <summary>组卷说明{paper.adjustments.length ? ` · ${paper.adjustments.length} 条调整` : ''}</summary>
            <div>
              <p>{paper.mode === 'exam' ? '本卷难度按易 → 中 → 难梯度分布。' : '本卷按所选难度档集中练习。'} 分值按题库记录计算。</p>
              {paper.items_json.some(item => item.question.score_source?.startsWith('derived')) && <p>分值说明：本卷分值按官方题型总分推导，不是官方逐题分值。</p>}
              {paper.items_json.every(item => item.question.is_fixture) && <p>当前为本地契约样例数据：题目为开发用样例，不代表官方真题。</p>}
              {paper.adjustments.map(a => <p key={a}>已调整：{a}</p>)}
            </div>
          </details>
        </section>
        <div className="paper-progress no-print"><span>已作答 {answered} / {paper.items_json.length}</span><div><i style={{ width: `${answered / paper.items_json.length * 100}%` }} /></div><span className="timer">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>{!result && <button className="primary small paper-submit-top" disabled={busy} onClick={submit}>{busy ? '正在判卷…' : '提交并判卷'}</button>}</div>
        <section className="question-list">{paper.items_json.map((item, index) => {
          const q = item.question, attempt = attemptMap.get(q.id);
          const reviewOpen = Boolean(expandedReviews[q.id]);
          const hasReviewDetails = Boolean(attempt?.explanation) || Boolean(attempt?.solution_steps?.length);
          return <article className={`question-card ${attempt ? (attempt.score_x2 === attempt.max_score_x2 ? 'correct' : 'incorrect') : ''}`} key={q.id}>
            <div className="question-meta"><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className={`source-tag ${q.is_fixture ? 'fixture' : q.source}`}>{q.is_fixture ? '本地契约样例 · 非真题' : q.source === 'real' ? `${q.year || '历年'} 真题 · 第 ${q.seq_label} 题` : 'AI 原创 · 已校验'}</span><span>{q.qtype === 'single_choice' ? '选择题' : q.qtype === 'fill_blank' ? '填空题' : '解答题'}</span><span>难度：{difficultyLabel(q.difficulty)}</span><span>{formatScore(item.score_x2)} 分</span></div>
            <div className="stem"><MathText text={q.stem_latex} /></div>
            <QuestionFigures assets={q.figure_assets} />
            {q.sub_items_json?.map(sub => <div className="sub-item" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
            {q.qtype === 'single_choice' && <div className="answer-options">{q.options_json?.map(option => {
              const correctLabel = attempt?.correct_answer?.trim().toUpperCase();
              const isCorrect = Boolean(attempt) && correctLabel === option.label;
              const isChosen = answers[q.id] === option.label;
              return <button key={option.label} disabled={Boolean(attempt)} className={`${isChosen ? 'chosen' : ''} ${attempt ? (isCorrect ? 'correct-option' : isChosen ? 'wrong-option' : '') : ''}`} onClick={() => setAnswers(a => ({ ...a, [q.id]: option.label }))}>
                <b>{option.label}</b><MathText text={option.latex} />{isCorrect && <span className="mark correct">✓</span>}{Boolean(attempt) && isChosen && !isCorrect && <span className="mark wrong">✗</span>}
              </button>;
            })}</div>}
            {q.qtype === 'fill_blank' && <input className="blank-answer" disabled={Boolean(attempt)} value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="填写答案，如 1 或 e^x" />}
            {q.qtype === 'free_response' && <div className="solution-input"><label className="upload-label">{recognizing[q.id] ? '正在识别手写解答…' : '上传手写解答'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={recognizing[q.id] || Boolean(attempt)} onChange={e => { const file = e.target.files?.[0]; if (file) void recognizeHandwriting(q.id, file); }} /></label><textarea disabled={Boolean(attempt)} value={answers[q.id] || ''} onChange={e => { setAnswers(a => ({ ...a, [q.id]: e.target.value })); setConfirmedLatex(c => ({ ...c, [q.id]: e.target.value })); }} placeholder="上传手写照片后自动转写，也可以直接输入 LaTeX 或文字。" rows={4} />{recognitionNotes[q.id] && <p className="recognition-note">{recognitionNotes[q.id]}</p>}</div>}
            {attempt && <div className="answer-review">
              <button type="button" className="correct-answer" onClick={() => setExpandedReviews(current => ({ ...current, [q.id]: !current[q.id] }))} aria-expanded={reviewOpen}>
                <strong>正确答案</strong>{attempt.correct_answer ? <MathText text={attempt.correct_answer} /> : <span>—</span>}
                {hasReviewDetails && <span className="expand-detail">{reviewOpen ? '收起解析 ▲' : '查看解析 ▼'}</span>}
              </button>
              {reviewOpen && <div className="answer-detail">
                {attempt.explanation && <p><strong>考点解析</strong><MathText text={attempt.explanation} /></p>}
                {attempt.solution_steps && attempt.solution_steps.length > 0 && <ol>{attempt.solution_steps.map((step, index) => <li key={index}><MathText text={step} /></li>)}</ol>}
                {!attempt.explanation && !attempt.solution_steps?.length && <p className="muted">这道题暂无更多解析。</p>}
              </div>}
              <div className="score-line">本题得分 {formatScore(attempt.score_x2)} / {formatScore(attempt.max_score_x2)}</div>
            </div>}
            {attempt && <div className="question-feedback"><strong>{attempt.grading_status === 'pending_review' ? '解答题待 rubric 模型复核' : attempt.score_x2 === attempt.max_score_x2 ? '回答正确' : '需要再看一眼'}</strong><span>{attempt.feedback || `得分 ${formatScore(attempt.score_x2)} / ${formatScore(attempt.max_score_x2)}`}</span></div>}
          </article>;
        })}</section>
        {result && <section className="grade-result no-print" id="grade-result"><span className="eyebrow">本次作答</span><h2>得分率 {result.score_rate_bp / 100}%</h2><p>得分 {formatScore(result.score_x2)} / {formatScore(result.max_score_x2)}。错题已自动加入错题本。</p><div className="source-score">{Object.entries(result.by_source).filter(([, v]) => v.max_score_x2 > 0).map(([key, value]) => <div key={key}><span>{key === 'real' ? '真题部分' : 'AI 原创部分'}</span><strong>{formatScore(value.score_x2)} / {formatScore(value.max_score_x2)}</strong></div>)}</div><div className="result-actions"><button onClick={async () => { await loadRepair(); setView('repair'); }}>开始修复 →</button><button onClick={loadWrong}>查看错题本</button><button onClick={() => { setView('compose'); setResult(null); }}>自由练习</button></div></section>}
      </>}
      {view === 'wrong' && <section className="simple-page"><h1>错题本</h1>
        {wrongItems.length > 0 && <div className="filter-bar">
          <div className="filter-tabs">
            <button className={wrongStatusFilter === 'all' ? 'active' : ''} onClick={() => setWrongStatusFilter('all')}>全部 <small>{wrongGroupCounts.all}</small></button>
            <button className={wrongStatusFilter === 'needs_repair' ? 'active' : ''} onClick={() => setWrongStatusFilter('needs_repair')}>待修复 <small>{wrongGroupCounts.needs_repair}</small></button>
            <button className={wrongStatusFilter === 'repairing' ? 'active' : ''} onClick={() => setWrongStatusFilter('repairing')}>修复中 <small>{wrongGroupCounts.repairing}</small></button>
            <button className={wrongStatusFilter === 'mastered' ? 'active' : ''} onClick={() => setWrongStatusFilter('mastered')}>已修复 <small>{wrongGroupCounts.mastered}</small></button>
          </div>
          <div className="filter-controls">
            <label>错因<select value={wrongCauseFilter} onChange={event => setWrongCauseFilter(event.target.value)}><option value="all">全部</option><option value="none">未诊断</option>{wrongCauses.map(cause => <option key={cause} value={cause}>{cause}</option>)}</select></label>
            <label>来源<select value={wrongSourceFilter} onChange={event => setWrongSourceFilter(event.target.value)}><option value="all">全部</option><option value="real">真题</option><option value="ai">AI 原创</option></select></label>
            <label>题型<select value={wrongTypeFilter} onChange={event => setWrongTypeFilter(event.target.value)}><option value="all">全部</option><option value="single_choice">选择题</option><option value="fill_blank">填空题</option><option value="free_response">解答题</option></select></label>
            <label>年份<select value={wrongYearFilter} onChange={event => setWrongYearFilter(event.target.value)}><option value="all">全部</option>{wrongYears.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
            <label>修复轮次<select value={wrongPassFilter} onChange={event => setWrongPassFilter(event.target.value)}><option value="all">全部</option><option value="0">0 轮</option><option value="1-2">1–2 轮</option><option value="3-4">3–4 轮</option><option value="5">5 轮</option></select></label>
            <label>知识点<select value={wrongKnowledgeFilter} onChange={event => setWrongKnowledgeFilter(event.target.value)}><option value="all">全部</option>{wrongKnowledge.map(node => <option key={node.code} value={node.code}>{node.name}</option>)}</select></label>
            {wrongFiltersActive && <button className="filter-clear" onClick={() => { setWrongStatusFilter('all'); setWrongCauseFilter('all'); setWrongSourceFilter('all'); setWrongTypeFilter('all'); setWrongYearFilter('all'); setWrongPassFilter('all'); setWrongKnowledgeFilter('all'); }}>清除筛选</button>}
            <span className="filter-result">显示 {filteredWrong.length} / {wrongItems.length}</span>
          </div>
        </div>}
        {wrongItems.length === 0 ? <div className="empty-card"><h2>暂时没有错题</h2><p>每日一题或试卷里答错的题会出现在这里。</p><button className="primary" onClick={() => setView('compose')}>去组一张卷</button></div> : <div className="wrong-list">{filteredWrong.map(item => {
        const question = item.question, review = item.review, attempt = item.attempt;
        const daily: DailyWrongAnswer | null = item.daily_answer;
        const answerRaw = daily ? daily.answer_raw : attempt?.answer_raw;
        const reviewOpen = Boolean(expandedReviews[item.question_id]);
        const hasDetails = Boolean(review?.explanation) || Boolean(review?.solution_steps?.length);
        const repairState = item.repair;
        const repairPasses = repairState?.repair_passes || 0;
        const repairNextAt = repairState?.next_repair_at ? new Date(repairState.next_repair_at) : null;
        return <article className="panel wrong-card" id={`wrong-${item.question_id}`} tabIndex={-1} key={item.question_id}>
          <div className="question-meta">{!daily && <span className="source-tag real">错题 · 修复 {repairPasses}/5 轮</span>}<span className={`source-tag ${question?.source === 'ai' ? 'ai' : 'real'}`}>{question?.source === 'ai' ? 'AI 原创' : `${question?.year || '历年'} 真题 · 第 ${question?.seq_label} 题`}</span><span>{qtypeLabel(question?.qtype)}</span></div>
          <div className="stem"><MathText text={question?.stem_latex || ''} /></div>
          <QuestionFigures assets={question?.figure_assets} />
          {question?.sub_items_json?.map((sub: any) => <div className="sub-item" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
          {question?.qtype === 'single_choice' && question.options_json?.length ? <div className="answer-options">{question.options_json.map((option: any) => {
            const correct = review?.correct_answer?.trim().toUpperCase() === option.label;
            const chosen = answerRaw === option.label;
            return <button key={option.label} disabled className={`${chosen ? 'chosen' : ''} ${correct ? 'correct-option' : chosen ? 'wrong-option' : ''}`}>
              <b>{option.label}</b><MathText text={option.latex} />{correct && <span className="mark correct">✓</span>}{chosen && !correct && <span className="mark wrong">✗</span>}
            </button>;
          })}</div> : null}
          {daily ? <div className="daily-wrong-answer">
            <strong>每日一题 · {daily.date} · {daily.correct ? '回答正确' : '回答错误'}</strong>
            <div>你的作答：{daily.answer_kind === 'image' && '图片已判定'}{daily.answer_raw && <MathText text={daily.answer_raw} />}{daily.answer_kind === 'text' && !daily.answer_raw && '无原文记录'}</div>
            {daily.feedback && <MathText text={daily.feedback} />}
          </div> : question?.qtype !== 'single_choice' && <div className="wrong-answer-line"><strong>你的作答</strong>{attempt?.answer_raw ? <MathText text={attempt.answer_raw} /> : <span>未作答</span>}</div>}
          {review && <div className="answer-review">
            <button type="button" className="correct-answer" onClick={() => setExpandedReviews(current => ({ ...current, [item.question_id]: !current[item.question_id] }))} aria-expanded={reviewOpen}>
              <strong>正确答案</strong>{review.correct_answer ? <MathText text={review.correct_answer} /> : <span>—</span>}
              {hasDetails && <span className="expand-detail">{reviewOpen ? '收起解析 ▲' : '查看解析 ▼'}</span>}
            </button>
            {reviewOpen && <div className="answer-detail">
              {review.explanation && <p><strong>考点解析</strong><MathText text={review.explanation} /></p>}
              {review.solution_steps && review.solution_steps.length > 0 && <ol>{review.solution_steps.map((step: string, index: number) => <li key={index}><MathText text={step} /></li>)}</ol>}
              {!review.explanation && !review.solution_steps?.length && <p className="muted">这道题暂无更多解析。</p>}
            </div>}
          </div>}
          <div className="mastery-box">
            <div className="mastery-row"><strong>修复进度</strong><span>{repairPasses}/5 轮 · {repairState?.repair_variants_done || 0}/15 题</span></div>
            <div className="mastery-bar"><i style={{ width: `${Math.min(100, repairPasses * 20)}%` }} /></div>
            {repairPasses >= 5
              ? <div className="mastered-row"><span>5 轮全部通过，可以移出错题本。</span><button className="mastery-delete" onClick={() => deleteWrong(item.question_id)} disabled={busy}>移出错题本</button></div>
              : repairNextAt && repairNextAt > new Date()
                ? <p className="muted">本轮已通过，下一轮 {repairNextAt.toLocaleDateString('zh-CN')} 后可再练。</p>
                : null}
          </div>
          <div className="wrong-repair-row">
            <div><strong>AI 修复</strong><span>{repairState?.diagnosis?.summary || '让 AI 诊断这道题的错因，再生成 3 道定向变式。'}</span></div>
            {repairState?.status === 'ready' && repairState.paper_id
              ? <button className="primary small" disabled={busy} onClick={() => openMyPaper(repairState.paper_id)}>打开修复卷 →</button>
              : repairState?.status === 'generating'
                ? <button className="primary small" disabled>AI 生成中…</button>
                : repairNextAt && repairNextAt > new Date()
                  ? <button className="primary small" disabled>下一轮待复习</button>
                  : <button className="primary small" disabled={busy || repairPasses >= 5} onClick={() => startRepair(item.question_id)}>{repairPasses ? '开始下一轮 →' : '让 AI 修复 →'}</button>}
          </div>
          <p className="muted">下次复习：{new Date(item.next_review_at).toLocaleDateString('zh-CN')}</p>
        </article>;
      })}{!filteredWrong.length && <div className="filter-empty">没有符合当前筛选的错题。</div>}</div>}
      </section>}
      {view === 'agent' && <AgentPanel aiConfigured={Boolean(aiSettings?.configured)} onOpenSettings={openSettings} onOpenPaper={data => { setPaperOrigin('papers'); setPaper(data); setResult(data.result || null); setAnswers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {}); setView('paper'); }} onQueueJob={job => { if (startedJobs.current.has(job.id)) return; setJobs(list => [...list, job]); setJobsOpen(true); }} />}
      {view === 'papers' && <section className="simple-page">
        <span className="eyebrow">你的组卷与作答记录</span><h1>我的试卷</h1>
        <p>点击试卷继续作答；需要留档时点「保存为 PDF」。未交卷保存空白卷，已交卷可选择带解析或空白卷。</p>
        <div className="filter-bar">
          <div className="filter-tabs">
            <button className={paperStatusFilter === 'all' ? 'active' : ''} onClick={() => setPaperStatusFilter('all')}>全部 <small>{paperStatusCounts.all}</small></button>
            <button className={paperStatusFilter === 'draft' ? 'active' : ''} onClick={() => setPaperStatusFilter('draft')}>待完成 <small>{paperStatusCounts.draft}</small></button>
            <button className={paperStatusFilter === 'submitted' ? 'active' : ''} onClick={() => setPaperStatusFilter('submitted')}>已交卷 <small>{paperStatusCounts.submitted}</small></button>
          </div>
          <div className="filter-controls">
            <label>类型<select value={paperOriginFilter} onChange={event => setPaperOriginFilter(event.target.value)}><option value="all">全部</option><option value="free">自由练习</option><option value="exam">真题整卷</option><option value="repair">错题修复</option><option value="variant">错题仿真</option></select></label>
            <label>模式<select value={paperModeFilter} onChange={event => setPaperModeFilter(event.target.value)}><option value="all">全部</option><option value="exam">整卷模考</option><option value="drill">专项突破</option></select></label>
            <label>题源<select value={paperSourceFilter} onChange={event => setPaperSourceFilter(event.target.value)}><option value="all">全部</option><option value="real">真题</option><option value="ai">AI 仿真</option><option value="mixed">混合</option></select></label>
            <label>年份<select value={paperYearFilter} onChange={event => setPaperYearFilter(event.target.value)}><option value="all">全部</option>{paperYears.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
            <label>时间<select value={paperTimeFilter} onChange={event => setPaperTimeFilter(event.target.value)}><option value="all">全部</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="older">更早</option></select></label>
            {paperFiltersActive && <button className="filter-clear" onClick={() => { setPaperStatusFilter('all'); setPaperOriginFilter('all'); setPaperModeFilter('all'); setPaperSourceFilter('all'); setPaperYearFilter('all'); setPaperTimeFilter('all'); }}>清除筛选</button>}
            <span className="filter-result">显示 {filteredPapers.length} / {myPapers.length}</span>
          </div>
        </div>
        {myPapers.length === 0 ? <div className="empty-card"><h2>还没有组卷记录</h2><p>生成第一张试卷后，这里会保存你的待做与已完成记录。</p><button className="primary" onClick={() => setView('compose')}>去组一张卷</button></div> : <div className="paper-history">
          {filteredPapers.map(paper => <article className="paper-history-item panel" key={paper.id}>
            <button className="paper-history-main" onClick={() => openMyPaper(paper.id)}>
              <div className="paper-history-top">
                <span className={`source-tag ${paper.status === 'submitted' ? 'real' : 'fixture'}`}>{paper.status === 'submitted' ? '已交卷' : '待完成'}</span>
                <span className="source-tag">{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</span>
                <span className={`source-tag ${paperOriginKey(paper) !== 'free' ? 'ai' : ''}`}>{paperOriginLabel(paper)}</span><span className={`source-tag ${paper.source_mode === 'real' ? 'real' : ''}`}>{sourceLabel(paper.source_mode)}</span>
                <span className="paper-history-date">{new Date(paper.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <h2>{paper.title}</h2>
              <p>{paper.questions} 题 · 卷面 {formatScore(paper.total_score_x2)} 分{paper.status === 'submitted' && paper.score_x2 != null ? ` · 得分 ${formatScore(paper.score_x2)} / ${formatScore(paper.max_score_x2)} · 得分率 ${paper.score_rate_bp / 100}%` : ' · 继续作答'}</p>
            </button>
            <div className="paper-history-actions">
              <button className="paper-history-open" onClick={() => openMyPaper(paper.id)}>{paper.status === 'submitted' ? '查看解析 →' : '继续作答 →'}</button>
              <button className="paper-pdf-button" onClick={() => paper.status === 'submitted' ? openPdfOptions(paper.id) : saveDraftPdfDirect(paper)}>保存为 PDF</button>
            </div>
          </article>)}
          {!filteredPapers.length && <div className="filter-empty">没有符合当前筛选的试卷。</div>}
        </div>}</section>}
      {view === 'metrics' && <section className="simple-page">
        <span className="eyebrow">公开、可复核的质量数据</span><h1>数据中心</h1>
        <p>展示聚合指标与近期组卷，不包含任何用户作答内容或设备标识。组卷记录可点击查看公开预览。</p>
        <div className="metric-grid">
          <div className="metric-card"><span>题库题目</span><strong>{metrics?.question_bank?.real + metrics?.question_bank?.ai || 0}</strong><small>真题 {metrics?.question_bank?.real || 0} / AI {metrics?.question_bank?.ai || 0}</small></div>
          <div className="metric-card"><span>组卷成功</span><strong>{metrics?.compose?.success ?? 0}</strong><small>失败 {metrics?.compose?.failure ?? 0} 次</small></div>
          <div className="metric-card"><span>组卷成功率</span><strong>{metrics?.compose?.success_rate == null ? '—' : `${metrics.compose.success_rate}%`}</strong><small>成功 /（成功 + 失败）</small></div>
          <div className="metric-card"><span>错题条目</span><strong>{metrics?.wrong_book_entries ?? '—'}</strong><small>匿名分桶</small></div>
        </div>
        <div className="panel recent-panel"><h2>近期组卷（任意用户，最近 8 张）</h2>
          {metrics?.recent_papers?.length ? <table className="recent-table"><thead><tr><th>时间</th><th>模式</th><th>题源</th><th>知识点</th><th>题量</th><th>卷面</th><th>年份</th><th>操作</th></tr></thead><tbody>{metrics.recent_papers.map((paper: any) => <tr key={paper.id} className="recent-row" onClick={() => openRecentPaper(paper.id)}><td>{new Date(paper.created_at).toLocaleString('zh-CN')}</td><td>{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</td><td>{sourceLabel(paper.source_mode)}</td><td>{paper.title || '综合练习'}</td><td>{paper.questions}</td><td>{paper.total_points} 分</td><td>{paper.years?.join('、') || '—'}</td><td><button className="recent-open" onClick={event => { event.stopPropagation(); openRecentPaper(paper.id); }}>查看</button></td></tr>)}</tbody></table> : <div className="empty-state">还没有组卷记录。</div>}
        </div>
        <div className="panel trend-panel"><h2>作答趋势</h2>{trends.length ? trends.map(t => <div className="trend-row" key={t.date}><span>{t.date}</span><div><i style={{ width: `${Math.min(100, t.attempts * 12)}%` }} /></div><strong>{t.attempts}</strong></div>) : <div className="empty-state">数据积累中，趋势图将在产生作答后展示。</div>}</div>
      </section>}
      </>}
      {subject === 'cs408' && cs408View === 'compose' && <Cs408Compose busy={cs408Busy} aiConfigured={Boolean(aiSettings?.configured)} onOpenSettings={openSettings} onStart={startCs408Practice} />}
      {subject === 'cs408' && cs408View === 'repair' && <Cs408RepairPanel
        cases={cs408RepairCases}
        loading={cs408RepairLoading}
        busy={cs408Busy}
        date={cs408RepairDate}
        backlogCount={cs408RepairBacklog}
        completedCount={cs408RepairCompleted}
        aiConfigured={Boolean(aiSettings?.configured)}
        onOpenSettings={openSettings}
        onStart={startCs408Repair}
        onOpenPaper={openCs408RepairPaper}
        onRefresh={() => void loadCs408Repair()}
        onOpenPractice={() => setCs408View('compose')}
        onOpenWrong={loadCs408Wrong}
      />}
      {subject === 'cs408' && cs408View === 'papers' && <Cs408YearList
        years={cs408Years}
        loading={cs408Loading}
        busy={cs408Busy}
        onOpen={openCs408Year}
      />}
      {subject === 'cs408' && cs408View === 'paper' && cs408Paper && <Cs408PaperView
        paper={cs408Paper}
        answers={cs408Answers}
        busy={cs408Busy}
        onAnswer={setCs408Answer}
        onSubmit={submitCs408}
        backLabel={cs408PaperBack === 'compose' ? '408 自由练习' : cs408PaperBack === 'repair' ? '408 今日修复' : cs408PaperBack === 'history' ? '408 我的试卷' : cs408PaperBack === 'metrics' ? '408 数据中心' : '408 历年真题'}
        onBack={() => { setCs408View(cs408PaperBack); window.scrollTo({ top: 0, behavior: 'instant' }); }}
        onWrong={loadCs408Wrong}
      />}
      {subject === 'cs408' && cs408View === 'history' && <Cs408History items={cs408History} loading={cs408HistoryLoading} onOpen={id => openCs408PaperById(id, 'history')} onPractice={() => setCs408View('compose')} />}
      {subject === 'cs408' && cs408View === 'wrong' && <Cs408WrongBook items={cs408Wrong} loading={cs408Busy} />}
      {subject === 'cs408' && cs408View === 'metrics' && <Cs408Dashboard metrics={cs408Metrics} loading={cs408MetricsLoading} onOpen={id => openCs408PaperById(id, 'metrics')} onRefresh={() => void loadCs408Metrics()} />}
      {subject === 'cs408' && cs408View === 'agent' && <Cs408AgentPanel aiConfigured={Boolean(aiSettings?.configured)} onOpenSettings={openSettings} />}
    </main>
    {jobs.length > 0 && <aside className="job-dock no-print" aria-live="polite">
      <button className="job-dock-head" onClick={() => setJobsOpen(open => !open)}>
        <span className={`job-pulse ${activeJobCount ? 'active' : ''}`} />
        <span className="job-dock-title"><strong>出卷队列</strong><small>{activeJobCount} 进行中 · {queuedJobCount} 排队{completedJobCount ? ` · ${completedJobCount} 已完成` : ''}</small></span>
        <span className="job-dock-toggle">{jobsOpen ? '收起' : '展开'}</span>
      </button>
      {jobsOpen && <div className="job-dock-list">
        {jobs.map(task => {
          const message = task.error ? (jobErrorMessages[task.error] || task.error) : '';
          return <div className={`job-item ${task.status}`} key={task.id}>
            <div className="job-item-head"><strong>{task.requestLabel}</strong><span>{task.status === 'queued' ? '排队中' : task.status === 'running' ? task.stage : task.status === 'succeeded' ? '已完成' : '失败'}</span></div>
            {(task.status === 'running' || task.status === 'queued') && <>
              <div className="job-progress"><i style={{ width: `${task.progress || 0}%` }} /></div>
              <div className="job-detail">{task.detail || '正在准备任务…'}</div>
              {task.expectedCount ? <div className="job-counters">
                <span>已生成 {task.generatedCount || 0}/{task.expectedCount}</span>
                <span>自测通过 {task.verifiedCount || 0}/{task.generatedCount || '—'}</span>
                <span>{task.progress || 0}%</span>
              </div> : null}
              <div className="job-steps">
                {['生成题目', '校验格式', '做题自测', '组装试卷'].map((label, index) => {
                  const currentPhase = jobPhaseIndex[task.phase || ''] ?? -1;
                  const state = currentPhase > index ? 'done' : currentPhase === index ? 'active' : '';
                  return <span key={label} className={state}>{label}</span>;
                })}
              </div>
            </>}
            {task.status === 'succeeded' && <div className="job-item-actions"><button className="primary small" onClick={() => openJobPaper(task)}>查看试卷</button><button className="job-dismiss" onClick={() => dismissJob(task.id)}>移除</button></div>}
            {task.status === 'failed' && <div className="job-error"><span>{message}</span><button className="job-dismiss" onClick={() => dismissJob(task.id)}>移除</button></div>}
          </div>;
        })}
        <p className="job-dock-note">同时生成 2 张，其余自动排队；期间可继续组卷。</p>
      </div>}
    </aside>}
    <footer className="no-print">题脉 · {subject === 'cs408' ? '考研 408' : '考研数学二'} {subject === 'math2' && <button aria-expanded={showMathHelp} onClick={() => setShowMathHelp(v => !v)}>公式输入说明</button>}{subject === 'math2' && showMathHelp && <span>可以输入 1/2、x^2，或用两个 $ 符号括住行内 LaTeX 公式。</span>}<span className="device-note">匿名设备：{deviceId().slice(0, 12)}…</span></footer>
  </div>;
}