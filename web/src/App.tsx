import { useEffect, useMemo, useRef, useState } from 'react';
import { MathText } from './components/MathText';
import { PdfPaper } from './components/PdfPaper';
import { AgentPanel } from './components/AgentPanel';
import { pdfFileName, pickPdfDestination, savePdfElement } from './lib/pdf';
import { deviceId, difficultyLabel, formatScore, request } from './lib/api';
import type { Difficulty, GradeResult, Knowledge, Paper, PaperMode, Qtype, SourceMode } from './types';

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

export default function App() {
  const [view, setView] = useState<'compose' | 'paper' | 'wrong' | 'papers' | 'metrics' | 'agent'>('compose');
  const [paperOrigin, setPaperOrigin] = useState<'compose' | 'papers'>('compose');
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
  const [selectedWrong, setSelectedWrong] = useState<string[]>([]);
  const [variantCounts, setVariantCounts] = useState<Record<string, number>>({});
  const [myPapers, setMyPapers] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [trends, setTrends] = useState<any[]>([]);
  const [showMathHelp, setShowMathHelp] = useState(false);
  const [elapsed, setElapsed] = useState(0);

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
    const savedId = localStorage.getItem('kaoyan-paper-id');
    if (savedId) {
      request<Paper>(`/api/papers/${savedId}`).then(data => {
        if (data.status !== 'draft') { localStorage.removeItem('kaoyan-paper-id'); return; }
        setPaper(data);
        const savedAnswers = localStorage.getItem(`kaoyan-answers-${data.id}`);
        if (savedAnswers) setAnswers(JSON.parse(savedAnswers));
        setView('paper');
      }).catch(() => localStorage.removeItem('kaoyan-paper-id'));
    }
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
  const searchResults = query ? knowledge.filter(n => n.name.includes(query) || n.aliases.some(a => a.includes(query))) : [];
  const subjects = knowledge.filter(n => n.level === 1);
  const attemptMap = useMemo(() => new Map(result?.attempts.map(a => [a.question_id, a]) || []), [result]);
  const answered = Object.values(answers).filter(Boolean).length;
  const activeJobCount = jobs.filter(task => task.status === 'running').length;
  const queuedJobCount = jobs.filter(task => task.status === 'queued').length;
  const completedJobCount = jobs.filter(task => task.status === 'succeeded').length;
  const variantTotal = selectedWrong.reduce((sum, id) => sum + (variantCounts[id] || 3), 0);

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
      setPaper(data); setAnswers({}); setResult(null); setExpandedReviews({}); setElapsed(0); setView('paper');
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
  function openJobPaper(task: JobTask) {
    if (!task.paper) return;
    setPaperOrigin('compose');
    setPaper(task.paper); setAnswers({}); setResult(null); setExpandedReviews({}); setElapsed(0); setView('paper');
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
        answers: paper.items_json.map(item => ({ question_id: item.question.id, answer_raw: answers[item.question.id] || '', duration_sec: elapsed })),
      } });
      setResult(data);
      setTimeout(() => document.getElementById('grade-result')?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) { setError(e instanceof Error ? e.message : '判卷失败'); }
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
        setAnswers(Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])));
        setResult(data.result);
      } else {
        const saved = localStorage.getItem(`kaoyan-answers-${data.id}`);
        setAnswers(saved ? JSON.parse(saved) : {});
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

  return <div className="app-shell">
    {recentPreview && <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="组卷详情" onClick={() => setRecentPreview(null)}><div className="preview-card" onClick={event => event.stopPropagation()}>
      <div className="preview-head"><div><span className="eyebrow">公开组卷预览</span><h2>{recentPreview.concepts?.map((node: any) => node.name).slice(0, 3).join(' · ') || '综合练习'}</h2><p>{recentPreview.mode === 'exam' ? '整卷模考' : '专项突破'} · {sourceLabel(recentPreview.source_mode)} · {recentPreview.items.length} 题 · {formatScore(recentPreview.total_score_x2)} 分</p></div><button className="preview-close" onClick={() => setRecentPreview(null)}>关闭</button></div>
      <p className="preview-note">{recentPreview.note}</p>
      <div className="preview-items">{recentPreview.items.map((item: any, index: number) => <article className="preview-item" key={item.question.id}>
        <div className="question-meta"><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className={`source-tag ${item.question.source}`}>{item.question.source === 'real' ? `${item.question.year || '历年'} 真题` : 'AI 原创'}</span><span>{qtypeLabel(item.question.qtype)}</span><span>{formatScore(item.score_x2)} 分</span></div>
        <div className="stem"><MathText text={item.question.stem_latex} /></div>
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
      <button className="brand" onClick={() => { setView('compose'); setResult(null); }}>
        <span className="brand-mark">∑</span><span><strong>研数</strong><small>考研数学二 · 智能练习</small></span>
      </button>
      <nav><button onClick={() => setView('compose')}>组卷</button><button onClick={() => setView('agent')}>学习助手</button><button onClick={loadWrong}>错题本</button><button onClick={loadMyPapers}>我的试卷</button><button onClick={loadMetrics}>数据中心</button><button onClick={openSettings}>模型设置</button></nav>
    </header>
    <main>
      {error && <div className="error-banner no-print" role="alert">{error}<button onClick={() => setError('')}>知道了</button></div>}
      {view === 'compose' && <>
        <section className="intro no-print">
          <span className="eyebrow">真题 · 仿真 · 精准复习</span>
          <h1>今天，想把哪块知识练明白？</h1>
          <p>选一个知识块，设定题量和难度。剩下的交给我们。</p>
        </section>
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
            {!knowledge.length && <div className="empty-state">正在连接本地服务并加载知识点…</div>}
          </section>
          <section className="panel settings-panel">
            <div className="section-heading"><span>02</span><div><h2>设定这张卷</h2><p>你可以随时调整。</p></div></div>
            <div className="field"><label>组卷模式</label><div className="segmented two"><button className={mode === 'exam' ? 'active' : ''} onClick={() => setMode('exam')}>整卷模考<small>易 → 中 → 难梯度</small></button><button className={mode === 'drill' ? 'active' : ''} onClick={() => setMode('drill')}>专项突破<small>同档集中练习</small></button></div></div>
            <div className="field"><label>题源</label><div className="source-options">{sourceOptions.map(item => <button key={item.value} className={source === item.value ? 'active' : ''} onClick={() => setSource(item.value)}><strong>{item.label}</strong><small>{item.value === 'real' ? item.note : item.value === 'mixed' ? `真题与 AI 各半，奇数时真题多 1 道（本卷 ${mixedRealCount} + ${mixedAiCount}）` : '后台生成约 10–60 秒，完成后右下角通知'}</small></button>)}</div></div>
            {source !== 'real' && <div className={`ai-provider-status ${aiSettings?.configured ? 'ok' : ''}`}><span>{aiSettings?.configured ? `模型：${aiSettings.model}` : '尚未配置模型服务，AI 出卷不可用'}</span><button onClick={openSettings}>{aiSettings?.configured ? '修改' : '去配置'}</button></div>}
            <div className="field"><label>题型与题量 <small>合计 {totalCount} / 30</small></label><div className="type-counts">{qtypeOptions.map(item => <div className="type-count-row" key={item.value}><span>{item.label}</span><div className="number-input compact"><button onClick={() => setTypeCount(item.value, typeCounts[item.value] - 1)}>−</button><input type="number" min={0} max={30} value={typeCounts[item.value]} onChange={e => setTypeCount(item.value, Number(e.target.value))} /><button onClick={() => setTypeCount(item.value, typeCounts[item.value] + 1)}>+</button></div></div>)}</div>{totalCount > 30 && <div className="field-error">题量合计不能超过 30。</div>}</div>
            <div className="field"><label>难度</label><div className="difficulty-row">{(['easy', 'medium', 'hard'] as Difficulty[]).map(d => <button key={d} className={difficulty === d ? 'active' : ''} onClick={() => setDifficulty(d)}>{difficultyLabel(d)}</button>)}</div></div>
            {!selected.length && <div className="compose-hint">请先在左侧选择知识点，才能生成试卷。</div>}
            <div className="summary"><span>{selected.length ? `已选 ${selected.length} 个知识块` : '尚未选择知识点'} · {totalCount} 题</span><button className="primary" disabled={busy || !selected.length || totalCount < 1 || totalCount > 30} onClick={askCompose}>{busy ? (source === 'real' ? '正在组卷…' : '正在加入队列…') : source === 'real' ? '生成试卷 →' : '加入出卷队列 →'}</button></div>
          </section>
        </div>
      </>}
      {view === 'paper' && paper && <>
        <div className="paper-toolbar no-print"><button className="back" onClick={() => setView(paperOrigin)}>← {paperOrigin === 'papers' ? '我的试卷' : '调整组卷'}</button></div>
        <section className="paper-head">
          <span className="eyebrow">{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</span>
          <h1>{paper.title || (paper.origin === 'variant' ? '错题仿真练习' : selectedNames.join(' · ')) || '数学二练习卷'}</h1>
          <p>{paper.items_json.length} 题 · 卷面 {formatScore(paper.total_score_x2)} 分 · {paper.actual_ratio.real} 道真题 / {paper.actual_ratio.ai} 道 AI 原创</p>
          <div className="paper-note">{paper.mode === 'exam' ? '本卷难度按易 → 中 → 难梯度分布。' : '本卷按所选难度档集中练习。'} 分值按题库记录计算。</div>
          {paper.items_json.some(item => item.question.score_source?.startsWith('derived')) && <div className="adjustment">分值说明：本卷分值按官方题型总分推导，不是官方逐题分值。</div>}
          {paper.items_json.every(item => item.question.is_fixture) && <div className="adjustment">当前为本地契约样例数据：题目为开发用样例，不代表官方真题。</div>}
          {paper.adjustments.map(a => <div className="adjustment no-print" key={a}>已调整：{a}</div>)}
        </section>
        <div className="paper-progress no-print"><span>已作答 {answered} / {paper.items_json.length}</span><div><i style={{ width: `${answered / paper.items_json.length * 100}%` }} /></div><span className="timer">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span></div>
        <section className="question-list">{paper.items_json.map((item, index) => {
          const q = item.question, attempt = attemptMap.get(q.id);
          const reviewOpen = Boolean(expandedReviews[q.id]);
          const hasReviewDetails = Boolean(attempt?.explanation) || Boolean(attempt?.solution_steps?.length);
          return <article className={`question-card ${attempt ? (attempt.score_x2 === attempt.max_score_x2 ? 'correct' : 'incorrect') : ''}`} key={q.id}>
            <div className="question-meta"><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className={`source-tag ${q.is_fixture ? 'fixture' : q.source}`}>{q.is_fixture ? '本地契约样例 · 非真题' : q.source === 'real' ? `${q.year || '历年'} 真题 · 第 ${q.seq_label} 题` : 'AI 原创 · 已校验'}</span><span>{q.qtype === 'single_choice' ? '选择题' : q.qtype === 'fill_blank' ? '填空题' : '解答题'}</span><span>难度：{difficultyLabel(q.difficulty)}</span><span>{formatScore(item.score_x2)} 分</span></div>
            <div className="stem"><MathText text={q.stem_latex} /></div>
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
            {q.qtype === 'free_response' && <div className="solution-input"><label className="upload-label">上传手写解答<input type="file" accept="image/png,image/jpeg" onChange={e => { const file = e.target.files?.[0]; if (file) setAnswers(a => ({ ...a, [q.id]: `待识别图片：${file.name}` })); }} /></label><textarea disabled={Boolean(attempt)} value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="手写识别将在正式后端接入；当前可在此输入或粘贴识别稿。" rows={4} /></div>}
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
        {!result && <div className="submit-bar no-print"><div><strong>做完了吗？</strong><span>未作答的题按 0 分计入，解答题需后续模型复核。</span></div><button className="primary" disabled={busy} onClick={submit}>{busy ? '正在判卷…' : '提交并判卷'}</button></div>}
        {result && <section className="grade-result no-print" id="grade-result"><span className="eyebrow">本次作答</span><h2>得分率 {result.score_rate_bp / 100}%</h2><p>得分 {formatScore(result.score_x2)} / {formatScore(result.max_score_x2)}。错题已自动加入错题本。</p><div className="source-score">{Object.entries(result.by_source).filter(([, v]) => v.max_score_x2 > 0).map(([key, value]) => <div key={key}><span>{key === 'real' ? '真题部分' : 'AI 原创部分'}</span><strong>{formatScore(value.score_x2)} / {formatScore(value.max_score_x2)}</strong></div>)}</div><div className="result-actions"><button onClick={loadWrong}>查看错题本</button><button className="primary" onClick={() => { setView('compose'); setResult(null); }}>再组一张卷</button></div></section>}
      </>}
      {view === 'wrong' && <section className="simple-page"><span className="eyebrow">只复习真正需要的内容</span><h1>错题本</h1><p>每道错题都保留当时的作答、正确答案和详细解析。</p>{wrongItems.length === 0 ? <div className="empty-card"><h2>暂时没有错题</h2><p>完成一张试卷后，做错的题会自动出现在这里。</p><button className="primary" onClick={() => setView('compose')}>去组一张卷</button></div> : <div className="wrong-list">{wrongItems.map(item => {
        const question = item.question, review = item.review, attempt = item.attempt;
        const reviewOpen = Boolean(expandedReviews[item.question_id]);
        const hasDetails = Boolean(review?.explanation) || Boolean(review?.solution_steps?.length);
        const stats = item.variant_stats;
        const selectedForVariant = selectedWrong.includes(item.question_id);
        return <article className="panel wrong-card" key={item.question_id}>
          <div className="wrong-select-row">
            <label className="wrong-select"><input type="checkbox" checked={selectedForVariant} onChange={() => toggleWrongSelection(item.question_id)} />选择本题做仿真练习</label>
            {selectedForVariant && <div className="variant-count-control">
              <span>生成仿真题</span>
              <div className="number-input compact">
                <button onClick={() => setVariantCount(item.question_id, variantCountFor(item.question_id) - 1)}>−</button>
                <input type="number" min={3} max={10} value={variantCountFor(item.question_id)} onChange={event => setVariantCount(item.question_id, Number(event.target.value))} />
                <button onClick={() => setVariantCount(item.question_id, variantCountFor(item.question_id) + 1)}>+</button>
              </div>
              <small>每题至少 3 道</small>
            </div>}
          </div>
          <div className="question-meta"><span className="source-tag real">错题 · 掌握度 {item.mastery}/5</span><span className={`source-tag ${question?.source === 'ai' ? 'ai' : 'real'}`}>{question?.source === 'ai' ? 'AI 原创' : `${question?.year || '历年'} 真题 · 第 ${question?.seq_label} 题`}</span><span>{qtypeLabel(question?.qtype)}</span></div>
          <div className="stem"><MathText text={question?.stem_latex || ''} /></div>
          {question?.sub_items_json?.map((sub: any) => <div className="sub-item" key={sub.label}><strong>{sub.label}</strong><MathText text={sub.prompt_latex} /></div>)}
          {question?.qtype === 'single_choice' && question.options_json?.length ? <div className="answer-options">{question.options_json.map((option: any) => {
            const correct = review?.correct_answer?.trim().toUpperCase() === option.label;
            const chosen = attempt?.answer_raw === option.label;
            return <button key={option.label} disabled className={`${chosen ? 'chosen' : ''} ${correct ? 'correct-option' : chosen ? 'wrong-option' : ''}`}>
              <b>{option.label}</b><MathText text={option.latex} />{correct && <span className="mark correct">✓</span>}{chosen && !correct && <span className="mark wrong">✗</span>}
            </button>;
          })}</div> : null}
          {question?.qtype !== 'single_choice' && <div className="wrong-answer-line"><strong>你的作答</strong>{attempt?.answer_raw ? <MathText text={attempt.answer_raw} /> : <span>未作答</span>}</div>}
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
            <div className="mastery-row"><strong>仿真练习掌握度</strong><span>{stats?.total ? (stats.pending ? '仿真卷待完成' : `${stats.correct}/${stats.total} 正确 · ${(stats.rate_bp / 100).toFixed(1).replace('.0', '')}%`) : '还未生成仿真题'}</span></div>
            {stats?.total ? <div className="mastery-bar"><i style={{ width: `${Math.min(100, (stats.rate_bp || 0) / 100)}%` }} /></div> : null}
            {stats?.mastered && <div className="mastered-row"><span>已完全掌握，可以移出错题本。</span><button className="mastery-delete" onClick={() => deleteWrong(item.question_id)} disabled={busy}>移出错题本</button></div>}
          </div>
          <p className="muted">下次复习：{new Date(item.next_review_at).toLocaleDateString('zh-CN')}</p>
        </article>;
      })}</div>}
        {wrongItems.length > 0 && <div className="variant-bar no-print">
          <div><strong>错题仿真练习</strong><span>已选 {selectedWrong.length} 道错题 · 共 {variantTotal} 道仿真题（每题至少 3 道）</span>{variantTotal > 30 && <em>合计不能超过 30 道，请减少错题或每题数量</em>}</div>
          <button className="primary" disabled={busy || !selectedWrong.length || variantTotal > 30} onClick={composeVariants}>生成仿真练习卷 →</button>
        </div>}
      </section>}
      {view === 'agent' && <AgentPanel aiConfigured={Boolean(aiSettings?.configured)} onOpenSettings={openSettings} onOpenPaper={data => { setPaperOrigin('papers'); setPaper(data); setResult(data.result || null); setAnswers(data.result ? Object.fromEntries(data.result.attempts.map(attempt => [attempt.question_id, attempt.answer_raw || ''])) : {}); setView('paper'); }} onQueueJob={job => { if (startedJobs.current.has(job.id)) return; setJobs(list => [...list, job]); setJobsOpen(true); }} />}
      {view === 'papers' && <section className="simple-page">
        <span className="eyebrow">你的组卷与作答记录</span><h1>我的试卷</h1>
        <p>点击试卷继续作答；需要留档时点「保存为 PDF」。未交卷保存空白卷，已交卷可选择带解析或空白卷。</p>
        {myPapers.length === 0 ? <div className="empty-card"><h2>还没有组卷记录</h2><p>生成第一张试卷后，这里会保存你的待做与已完成记录。</p><button className="primary" onClick={() => setView('compose')}>去组一张卷</button></div> : <div className="paper-history">
          {myPapers.map(paper => <div className="paper-history-item" key={paper.id}>
            <button className="panel paper-history-row" onClick={() => openMyPaper(paper.id)}>
              <div className="paper-history-top">
                <span className={`source-tag ${paper.status === 'submitted' ? 'real' : 'fixture'}`}>{paper.status === 'submitted' ? '已交卷' : '待完成'}</span>
                <span className="source-tag">{paper.mode === 'exam' ? '整卷模考' : '专项突破'}</span>
                <span className={`source-tag ${paper.origin === 'variant' ? 'ai' : ''}`}>{paper.origin === 'variant' ? '错题仿真' : sourceLabel(paper.source_mode)}</span>
                <span className="paper-history-date">{new Date(paper.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <h2>{paper.title}</h2>
              <p>{paper.questions} 题 · 卷面 {formatScore(paper.total_score_x2)} 分{paper.status === 'submitted' && paper.score_x2 != null ? ` · 得分 ${formatScore(paper.score_x2)} / ${formatScore(paper.max_score_x2)} · 得分率 ${paper.score_rate_bp / 100}%` : ' · 继续作答'}</p>
              <span className="paper-history-action">{paper.status === 'submitted' ? '查看解析 →' : '继续作答 →'}</span>
            </button>
            <button className="paper-pdf-button" onClick={() => paper.status === 'submitted' ? openPdfOptions(paper.id) : saveDraftPdfDirect(paper)}>保存为 PDF</button>
          </div>)}
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
    <footer className="no-print">研数 · 本地开发切片 <button onClick={() => setShowMathHelp(v => !v)}>公式输入说明</button>{showMathHelp && <span> 当前题目使用 KaTeX 渲染；线上不会导出需要自行编译的 LaTeX 源码。</span>}<span className="device-note">匿名设备：{deviceId().slice(0, 12)}…</span></footer>
  </div>;
}