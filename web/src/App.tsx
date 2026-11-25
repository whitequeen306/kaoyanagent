import { useEffect, useMemo, useRef, useState } from 'react';
import { MathBackdrop } from './components/MathBackdrop';
import { useCs408Workspace } from './hooks/useCs408Workspace';
import { useJobQueue, type JobTask } from './hooks/useJobQueue';
import { JobDock } from './components/JobDock';
import { TopBar } from './components/TopBar';
import { SettingsModal } from './components/SettingsModal';
import { MathYearList } from './components/MathYearList';
import { RecentPaperPreview } from './components/RecentPaperPreview';
import { PdfExportOverlays } from './components/PdfExportOverlays';
import { ComposeConfirmModal } from './components/ComposeConfirmModal';
import { usePdfExport } from './hooks/usePdfExport';
import { useAiSettings } from './hooks/useAiSettings';
import { useDailyQuestion } from './hooks/useDailyQuestion';
import { AgentPanel } from './components/AgentPanel';
import { RepairPanel } from './components/RepairPanel';
import { Cs408YearList } from './components/Cs408YearList';
import { Cs408Compose } from './components/Cs408Compose';
import { Cs408RepairPanel } from './components/Cs408RepairPanel';
import { Cs408History } from './components/Cs408History';
import { Cs408Dashboard } from './components/Cs408Dashboard';
import { Cs408AgentPanel } from './components/Cs408AgentPanel';
import { Cs408PaperView } from './components/Cs408PaperView';
import { Cs408WrongBook } from './components/Cs408WrongBook';
import { MathComposeView } from './views/MathComposeView';
import { MathPaperView } from './views/MathPaperView';
import { MathWrongView } from './views/MathWrongView';
import { MathPapersView } from './views/MathPapersView';
import { MathMetricsView } from './views/MathMetricsView';
import { deviceId, request } from './lib/api';
import { sourceLabel } from './lib/paperMeta';
import type { Difficulty, GradeResult, Knowledge, MathExamYear, Paper, PaperMode, Qtype, RepairCase, SourceMode } from './types';

export default function App() {
  const [view, setView] = useState<'repair' | 'compose' | 'paper' | 'wrong' | 'papers' | 'examPapers' | 'metrics' | 'agent'>('compose');
  const [paperOrigin, setPaperOrigin] = useState<'compose' | 'papers' | 'repair' | 'exams'>('compose');
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<Qtype, number>>({ single_choice: 2, fill_blank: 2, free_response: 1 });
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
  const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});
  const [recentPreview, setRecentPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [wrongItems, setWrongItems] = useState<any[]>([]);
  const [repairCases, setRepairCases] = useState<RepairCase[]>([]);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairDate, setRepairDate] = useState('');
  const [repairBacklogCount, setRepairBacklogCount] = useState(0);
  const dailyWrongTarget = useRef<string | null>(null);
  const [myPapers, setMyPapers] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [trends, setTrends] = useState<any[]>([]);
  const [mathExamYears, setMathExamYears] = useState<MathExamYear[]>([]);
  const [mathExamLoading, setMathExamLoading] = useState(false);
  const [showMathHelp, setShowMathHelp] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [subject, setSubject] = useState<'math2' | 'cs408'>(() => localStorage.getItem('kaoyan-subject') === 'cs408' ? 'cs408' : 'math2');

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
  }, []);
  useEffect(() => {
    if (!paper) return;
    localStorage.setItem('kaoyan-paper-id', paper.id);
    localStorage.setItem(`kaoyan-answers-${paper.id}`, JSON.stringify(answers));
  }, [paper?.id, answers]);
  const selectedNames = useMemo(() => knowledge.filter(n => selected.includes(n.id)).map(n => n.name), [knowledge, selected]);
  const totalCount = Object.values(typeCounts).reduce((sum, value) => sum + value, 0);
  const activeTypes = (Object.entries(typeCounts) as [Qtype, number][]).filter(([, value]) => value > 0);
  const mixedRealCount = Math.ceil(totalCount / 2);
  const mixedAiCount = totalCount - mixedRealCount;
  const answered = Object.values(answers).filter(Boolean).length;
  const {
    jobs, jobsOpen, setJobsOpen, completedJobCount,
    enqueueJob, dismissJob,
  } = useJobQueue();
  const {
    aiSettings, setAiSettings,
    settingsOpen, setSettingsOpen, settingsForm, setSettingsForm,
    settingsBusy, settingsMessage, settingsSuccess,
    openSettings, saveAiSettings,
  } = useAiSettings();
  const { daily } = useDailyQuestion({ openSettings, aiConfigured: Boolean(aiSettings?.configured), onError: setError });
  const {
    pdfPaper, pdfChoiceOpen, setPdfChoiceOpen, pdfLoading, pdfStage, pdfBusy, pdfMessage,
    openPdfOptions, savePaperPdf, saveDraftPdfDirect,
  } = usePdfExport(setError);
  const {
    cs408View, setCs408View, cs408PaperBack, cs408Years, cs408Paper, cs408Answers,
    cs408Wrong, cs408RepairCases, cs408RepairDate, cs408RepairBacklog, cs408RepairCompleted,
    cs408RepairLoading, cs408History, cs408HistoryLoading, cs408Metrics, cs408MetricsLoading,
    cs408Busy, cs408Loading,
    loadCs408Years, openCs408Year, startCs408Practice, loadCs408Repair, startCs408Repair,
    openCs408RepairPaper, loadCs408History, loadCs408Metrics, openCs408PaperById,
    loadCs408Wrong, submitCs408, setCs408Answer, openCs408JobPaper,
  } = useCs408Workspace({
    subject, completedJobCount, aiSettings, openSettings, setError,
    onQueueJob: enqueueJob,
  });


  useEffect(() => {
    if (view === 'repair') void loadRepair();
  }, [view, completedJobCount]);


  function setTypeCount(type: Qtype, value: number) {
    const others = totalCount - typeCounts[type];
    const safe = Math.max(0, Math.min(30 - others, Number.isFinite(value) ? value : 0));
    setTypeCounts(current => ({ ...current, [type]: safe }));
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
        enqueueJob({
          id: queued.job_id, status: 'queued', stage: queued.stage || '排队中', progress: queued.progress || 0,
          requestLabel: `${sourceLabel(source)} · ${totalCount} 题`,
          detail: queued.detail, phase: queued.phase, expectedCount: queued.expected_count || 0,
          generatedCount: 0, verifiedCount: 0, reusedCount: queued.reused_count || 0,
        });
        return;
      }
      const data = await request<Paper>('/api/papers/compose', { method: 'POST', body });
      setPaperOrigin('compose');
      setPaper(data); setAnswers({}); setConfirmedLatex({}); setRecognitionNotes({}); setResult(null); setExpandedReviews({}); setElapsed(0); setView('paper');
    } catch (e) { setError(e instanceof Error ? e.message : '组卷失败'); }
    finally { setBusy(false); }
  }
  async function openJobPaper(task: JobTask) {
    if (!task.paper) return;
    if ((task.paper as any).subject === 'cs408') {
      try {
        setSubject('cs408');
        localStorage.setItem('kaoyan-subject', 'cs408');
        await openCs408JobPaper(task.paper.id);
      } catch (e) { setError(e instanceof Error ? e.message : '408 修复卷加载失败'); }
      return;
    }
    setPaperOrigin((task.paper as any).config_json?.origin === 'repair' ? 'repair' : 'compose');
    setPaper(task.paper); setAnswers({}); setConfirmedLatex({}); setRecognitionNotes({}); setResult(null); setExpandedReviews({}); setElapsed(0); setView('paper');
    dismissJob(task.id);
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
      enqueueJob({
        id: data.job_id, status: 'queued', stage: data.stage || '排队中', progress: data.progress || 0,
        requestLabel: 'AI 修复 · 错因诊断与定向变式', detail: data.detail || '正在准备 AI 修复…',
        phase: data.phase, expectedCount: data.expected_count || 3, generatedCount: 0, verifiedCount: 0, reusedCount: 0,
      });
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
      setView('wrong');
    }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } finally { setBusy(false); }
  }
  async function deleteWrong(id: string) {
    setBusy(true); setError('');
    try {
      await request(`/api/wrong-book/${id}`, { method: 'DELETE' });
      setWrongItems(list => list.filter(item => item.question_id !== id));
    } catch (e) { setError(e instanceof Error ? e.message : '移出错题本失败'); }
    finally { setBusy(false); }
  }
  async function loadMyPapers() {
    setBusy(true); setError('');
    try { const data = await request<{ items: any[] }>('/api/papers'); setMyPapers(data.items); setView('papers'); }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } finally { setBusy(false); }
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
  return <div className="app-shell">
    <MathBackdrop subject={subject} />
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {recentPreview && <RecentPaperPreview preview={recentPreview} onClose={() => setRecentPreview(null)} />}
    {previewLoading && <div className="preview-loading no-print">正在加载组卷详情…</div>}
    <SettingsModal
      open={settingsOpen}
      busy={settingsBusy}
      form={settingsForm}
      message={settingsMessage}
      success={settingsSuccess}
      hasKey={Boolean(aiSettings?.has_key)}
      keyHint={aiSettings?.key_hint || ''}
      onClose={() => setSettingsOpen(false)}
      onChange={patch => setSettingsForm(current => ({ ...current, ...patch }))}
      onSave={saveAiSettings}
    />
    {pdfLoading && <div className="preview-loading no-print">正在读取试卷…</div>}
    <PdfExportOverlays
      choiceOpen={pdfChoiceOpen}
      paper={pdfPaper}
      busy={pdfBusy}
      stage={pdfStage}
      message={pdfMessage}
      onCloseChoice={() => setPdfChoiceOpen(false)}
      onSave={savePaperPdf}
    />
    <ComposeConfirmModal
      open={confirming}
      selectedNames={selectedNames}
      mode={mode}
      source={source}
      totalCount={totalCount}
      mixedRealCount={mixedRealCount}
      mixedAiCount={mixedAiCount}
      typeCounts={typeCounts}
      difficulty={difficulty}
      onClose={() => setConfirming(false)}
      onConfirm={compose}
    />
    <TopBar
      subject={subject}
      view={view}
      cs408View={cs408View}
      onSwitchSubject={switchSubject}
      onBrand={() => { if (subject === 'cs408') setCs408View('papers'); else { setView('compose'); setResult(null); } }}
      onOpenSettings={openSettings}
      actions={{
        compose: () => setView('compose'),
        mathExams: () => { window.scrollTo({ top: 0, behavior: 'instant' }); void loadMathExamYears(); },
        repair: () => { void loadRepair(); setView('repair'); },
        wrong: loadWrong,
        papers: loadMyPapers,
        metrics: loadMetrics,
        agent: () => setView('agent'),
        cs408Compose: () => { setCs408View('compose'); window.scrollTo({ top: 0, behavior: 'instant' }); },
        cs408Repair: () => { setCs408View('repair'); window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408Repair(); },
        cs408Papers: () => { setCs408View('papers'); window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408Years(); },
        cs408History: () => { window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408History(); },
        cs408Wrong: loadCs408Wrong,
        cs408Metrics: () => { window.scrollTo({ top: 0, behavior: 'instant' }); void loadCs408Metrics(); },
        cs408Agent: () => { setCs408View('agent'); window.scrollTo({ top: 0, behavior: 'instant' }); },
      }}
    />
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
      {view === 'compose' && <MathComposeView
        knowledge={knowledge}
        selected={selected}
        mode={mode}
        source={source}
        difficulty={difficulty}
        typeCounts={typeCounts}
        totalCount={totalCount}
        mixedRealCount={mixedRealCount}
        mixedAiCount={mixedAiCount}
        busy={busy}
        aiSettings={aiSettings}
        openSettings={openSettings}
        daily={daily}
        onToggleKnowledge={toggleKnowledge}
        onMode={setMode}
        onSource={setSource}
        onDifficulty={setDifficulty}
        onTypeCount={setTypeCount}
        onCompose={askCompose}
        onDailyWrong={questionId => { dailyWrongTarget.current = questionId; void loadWrong(); }}
      />}
      {view === 'examPapers' && <MathYearList years={mathExamYears} loading={mathExamLoading} busy={busy} onOpen={openMathExamYear} />}
      {view === 'paper' && paper && <MathPaperView
        paper={paper}
        answers={answers}
        confirmedLatex={confirmedLatex}
        recognizing={recognizing}
        recognitionNotes={recognitionNotes}
        expandedReviews={expandedReviews}
        result={result}
        answered={answered}
        elapsed={elapsed}
        busy={busy}
        selectedNames={selectedNames}
        paperOrigin={paperOrigin}
        onBack={() => setView(paperOrigin === 'exams' ? 'examPapers' : paperOrigin)}
        onAnswer={(questionId, value) => setAnswers(current => ({ ...current, [questionId]: value }))}
        onConfirmedLatex={(questionId, value) => setConfirmedLatex(current => ({ ...current, [questionId]: value }))}
        onRecognize={recognizeHandwriting}
        onToggleReview={questionId => setExpandedReviews(current => ({ ...current, [questionId]: !current[questionId] }))}
        onSubmit={submit}
        onLoadRepair={() => { void loadRepair(); setView('repair'); }}
        onLoadWrong={loadWrong}
        onCompose={() => { setView('compose'); setResult(null); }}
      />}
      {view === 'wrong' && <MathWrongView
        items={wrongItems}
        busy={busy}
        expandedReviews={expandedReviews}
        onToggleReview={questionId => setExpandedReviews(current => ({ ...current, [questionId]: !current[questionId] }))}
        onStartRepair={startRepair}
        onOpenPaper={openMyPaper}
        onDelete={deleteWrong}
        onCompose={() => setView('compose')}
      />}
      {view === 'agent' && <AgentPanel aiConfigured={Boolean(aiSettings?.configured)} onOpenSettings={openSettings} onOpenPaper={data => { setPaperOrigin('papers'); setPaper(data); setResult(data.result || null); setAnswers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {}); setView('paper'); }} onQueueJob={enqueueJob} />}
      {view === 'papers' && <MathPapersView
        papers={myPapers}
        onOpen={openMyPaper}
        onOpenPdf={openPdfOptions}
        onDraftPdf={saveDraftPdfDirect}
        onCompose={() => setView('compose')}
      />}
      {view === 'metrics' && <MathMetricsView metrics={metrics} trends={trends} onOpenRecent={openRecentPaper} />}
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
    <JobDock jobs={jobs} open={jobsOpen} onToggle={() => setJobsOpen(open => !open)} onOpenPaper={openJobPaper} onDismiss={dismissJob} />
    <footer className="no-print">题脉 · {subject === 'cs408' ? '考研 408' : '考研数学二'} {subject === 'math2' && <button aria-expanded={showMathHelp} onClick={() => setShowMathHelp(v => !v)}>公式输入说明</button>}{subject === 'math2' && showMathHelp && <span>可以输入 1/2、x^2，或用两个 $ 符号括住行内 LaTeX 公式。</span>}<span className="device-note">匿名设备：{deviceId().slice(0, 12)}…</span></footer>
  </div>;
}