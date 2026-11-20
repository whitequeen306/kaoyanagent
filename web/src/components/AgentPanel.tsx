import { useEffect, useRef, useState } from 'react';
import { MathText } from './MathText';
import { request } from '../lib/api';
import type { Paper } from '../types';

type AgentPanelProps = {
  aiConfigured: boolean;
  onOpenSettings: () => void;
  onOpenPaper: (paper: Paper) => void;
  onQueueJob: (job: any) => void;
};

const emptyProfile = { subject: '数学二', exam_year: 2027, target_score: '', foundation: '一般', stage: '强化', weekly_minutes: '', daily_minutes: '', weak_points: [], notes: '' };
const emptyPreferences = { source_mode: 'mixed', question_count: 6, difficulty: 'medium', detail_level: 'detailed', hint_first: true };
const agentToolLabels: Record<string, string> = {
  get_user_context: '读取学习档案',
  update_preferences: '更新学习偏好',
  update_agent_summary: '更新学习总结',
  list_wrong_questions: '查看错题本',
  get_question_detail: '阅读题目与解析',
  list_papers: '翻看历史试卷',
  get_paper_detail: '查看试卷作答情况',
  get_today_review: '检查今日复习',
  list_knowledge_nodes: '查找知识点',
  diagnose_attempts: '分析近期得分情况',
  compose_paper: '生成练习卷',
  create_wrong_variants: '生成错题变式题',
  create_study_plan: '保存学习计划',
  get_study_plan: '读取学习计划',
};
function friendlyStage(stage: string) {
  if (!stage) return '准备中';
  if (stage === '整理工具结果') return '正在整理结果';
  if (stage === '理解需求') return '正在理解你的目标';
  if (stage === '等待确认') return '需要你确认';
  if (stage === '完成') return '已完成';
  if (stage === '已取消') return '已取消';
  if (['生成题目', '校验题目格式', '做题自测', '组装试卷', '生成仿真题'].includes(stage)) return `正在${stage}`;
  return stage;
}
function formatAgentText(text: string) {
  return String(text || '').split(/(\$[^$]*\$)/g).map((part, index) => index % 2
    ? part
    : part.replace(/([^\n])(?=(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d{1,2}[.、)]\s|[-•]\s))/g, '$1\n')).join('');
}
function ThinkingDots() {
  return <span className="agent-thinking" aria-label="正在思考"><i /><i /><i /></span>;
}

export function AgentPanel({ aiConfigured, onOpenSettings, onOpenPaper, onQueueJob }: AgentPanelProps) {
  const [state, setState] = useState<any>(null);
  const [profile, setProfile] = useState<any>(emptyProfile);
  const [preferences, setPreferences] = useState<any>(emptyPreferences);
  const [goal, setGoal] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const resumedTasks = useRef(new Set<string>());

  async function loadState() {
    const data = await request<any>('/api/agent/state');
    setState(data);
    setProfile({ ...emptyProfile, ...data.user_profile });
    setPreferences({ ...emptyPreferences, ...data.preferences });
    setTasks(data.tasks || []);
    if (selectedTaskId && data.tasks?.some((task: any) => task.id === selectedTaskId)) {
      const selected = data.tasks.find((task: any) => task.id === selectedTaskId);
      setConversationId(selected.conversation_id);
    } else if (data.conversations?.length) {
      setConversationId(data.conversations[data.conversations.length - 1].id);
    }
  }
  useEffect(() => { loadState().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!conversationId) return;
    request<any>(`/api/agent/conversations/${conversationId}`).then(data => setMessages(data.messages || [])).catch(() => {});
  }, [conversationId]);
  useEffect(() => {
    const resumable = tasks.find((task: any) => ['queued', 'waiting_async'].includes(task.status));
    if (!resumable || busy || resumedTasks.current.has(resumable.id)) return;
    resumedTasks.current.add(resumable.id);
    setSelectedTaskId(resumable.id);
    setConversationId(resumable.conversation_id);
    runAgentTask(resumable.id).then(async () => {
      if (resumable.conversation_id) {
        const conversation = await request<any>(`/api/agent/conversations/${resumable.conversation_id}`);
        setMessages(conversation.messages || []);
      }
      await loadState();
    }).catch(error => setError(error instanceof Error ? error.message : '任务恢复失败'));
  }, [tasks]);

  async function saveProfile() {
    setBusy(true); setError('');
    try {
      await request('/api/agent/profile', { method: 'POST', body: profile });
      await request('/api/agent/preferences', { method: 'POST', body: preferences });
      await loadState();
      setProfileOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function clearSummary() {
    if (!window.confirm('确定清除 Agent 自己总结的档案吗？用户填写的档案不会受影响。')) return;
    await request('/api/agent/summary', { method: 'DELETE' });
    await loadState();
  }
  async function completePlan(planId: string) {
    await request(`/api/agent/plans/${planId}`, { method: 'PATCH', body: { status: 'completed' } });
    await loadState();
  }
  async function startGoal(value = goal) {
    if (!value.trim()) { setError('请先告诉助手你想完成什么。'); return; }
    if (!aiConfigured) { onOpenSettings(); return; }
    setBusy(true); setError('');
    try {
      const task = await request<any>('/api/agent/tasks', { method: 'POST', body: { goal: value.trim(), conversation_id: conversationId } });
      resumedTasks.current.add(task.id);
      setConversationId(task.conversation_id);
      setSelectedTaskId(task.id);
      setTasks(current => [task, ...current]);
      setGoal('');
      const conversation = await request<any>(`/api/agent/conversations/${task.conversation_id}`);
      setMessages(conversation.messages || []);
      await runAgentTask(task.id);
      const refreshed = await request<any>(`/api/agent/conversations/${task.conversation_id}`);
      setMessages(refreshed.messages || []);
      await loadState();
    } catch (e) { setError(e instanceof Error ? e.message : '任务启动失败'); }
    finally { setBusy(false); }
  }
  async function confirmTask(id: string, approve: boolean) {
    setBusy(true); setError('');
    try {
      const task = await request<any>(`/api/agent/tasks/${id}/confirm`, { method: 'POST', body: { approve } });
      setTasks(list => list.map(item => item.id === id ? task : item));
      if (approve) {
        resumedTasks.current.add(id);
        await runAgentTask(id);
        const conversation = conversationId ? await request<any>(`/api/agent/conversations/${conversationId}`) : null;
        if (conversation) setMessages(conversation.messages || []);
      }
      await loadState();
    } catch (e) { setError(e instanceof Error ? e.message : '确认失败'); }
    finally { setBusy(false); }
  }
  async function runAgentTask(id: string) {
    for (let index = 0; index < 120; index += 1) {
      const current = await request<any>(`/api/agent/tasks/${id}/step`, { method: 'POST', body: {} });
      setTasks(list => list.map(task => task.id === id ? current : task));
      if (['succeeded', 'failed', 'waiting_user', 'degraded', 'cancelled'].includes(current.status)) return;
      await new Promise(resolve => setTimeout(resolve, current.status === 'waiting_async' ? 1000 : 500));
    }
  }
  async function openArtifact(artifact: any) {
    if (artifact.type === 'paper') {
      const data = await request<Paper>(`/api/papers/${artifact.id}`);
      onOpenPaper(data);
    } else if (artifact.type === 'job') {
      onQueueJob({ id: artifact.id, status: 'queued', stage: '已加入出卷队列', progress: 0, requestLabel: '学习助手 · 组卷任务', expectedCount: 0 });
    }
  }

  const activeTask = tasks.find((task: any) => task.id === selectedTaskId) || tasks[0];
  const running = Boolean(activeTask && !['succeeded', 'failed', 'waiting_user', 'degraded', 'cancelled'].includes(activeTask.status));
  const hasAssistantReply = messages.some((message: any) => message.role === 'assistant' && message.content === activeTask?.result?.reply);
  const hasProfile = Boolean(state?.user_profile?.exam_year || state?.user_profile?.weekly_minutes || state?.user_profile?.notes);
  return <section className="agent-page">
    <div className="agent-hero">
      <span className="eyebrow">会读你的学习记录，也会调用工具</span>
      <h1>学习助手</h1>
      <p>告诉我你的目标、时间和薄弱点。我会结合你的档案、错题和试卷记录，给出下一步，并在你确认后执行。</p>
    </div>
    <div className="agent-layout">
      <aside className="agent-sidebar">
        <section className="panel agent-profile-card">
          <div className="agent-card-head"><h2>学习档案</h2><button onClick={() => setProfileOpen(open => !open)}>{profileOpen ? '收起' : hasProfile ? '编辑' : '填写'}</button></div>
          {profileOpen ? <div className="profile-form">
            <div className="form-grid"><label>考试科目<input value="数学二" disabled /></label><label>考研年份<input type="number" value={profile.exam_year || ''} onChange={e => setProfile((p: any) => ({ ...p, exam_year: Number(e.target.value) }))} /></label></div>
            <label>目标分数<input type="number" min="0" max="150" value={profile.target_score || ''} onChange={e => setProfile((p: any) => ({ ...p, target_score: Number(e.target.value) }))} placeholder="可选" /></label>
            <div className="form-grid"><label>当前基础<select value={profile.foundation} onChange={e => setProfile((p: any) => ({ ...p, foundation: e.target.value }))}><option>薄弱</option><option>一般</option><option>扎实</option></select></label><label>学习阶段<select value={profile.stage} onChange={e => setProfile((p: any) => ({ ...p, stage: e.target.value }))}><option>基础</option><option>强化</option><option>冲刺</option></select></label></div>
            <div className="form-grid"><label>每周可用分钟<input type="number" value={profile.weekly_minutes || ''} onChange={e => setProfile((p: any) => ({ ...p, weekly_minutes: Number(e.target.value) }))} placeholder="例如 600" /></label><label>每天可用分钟<input type="number" value={profile.daily_minutes || ''} onChange={e => setProfile((p: any) => ({ ...p, daily_minutes: Number(e.target.value) }))} placeholder="例如 60" /></label></div>
            <label>近期情况<textarea value={profile.notes || ''} onChange={e => setProfile((p: any) => ({ ...p, notes: e.target.value }))} placeholder="例如：极限和积分不稳定，每天有 1 小时" rows={3} /></label>
            <div className="preference-line"><label>偏好题源<select value={preferences.source_mode} onChange={e => setPreferences((p: any) => ({ ...p, source_mode: e.target.value }))}><option value="real">真题</option><option value="mixed">混合</option><option value="ai">AI 仿真</option></select></label><label>默认题量<input type="number" min="1" max="30" value={preferences.question_count} onChange={e => setPreferences((p: any) => ({ ...p, question_count: Number(e.target.value) }))} /></label><label>默认难度<select value={preferences.difficulty} onChange={e => setPreferences((p: any) => ({ ...p, difficulty: e.target.value }))}><option value="easy">易</option><option value="medium">中</option><option value="hard">难</option></select></label></div>
            <button className="primary" onClick={saveProfile} disabled={busy}>{busy ? '保存中…' : '保存档案与偏好'}</button>
          </div> : <div className="profile-summary"><p>{profile.exam_year ? `${profile.exam_year} 考研` : '未填写届别'} · {profile.foundation}基础 · {profile.stage}阶段</p><p className="muted">{profile.weekly_minutes ? `每周 ${profile.weekly_minutes} 分钟` : '未填写可用时间'}{profile.target_score ? ` · 目标 ${profile.target_score} 分` : ''}</p><p className="muted">偏好：{preferences.source_mode === 'real' ? '真题' : preferences.source_mode === 'ai' ? 'AI 仿真' : '混合'} · {preferences.question_count} 题 · {preferences.difficulty === 'easy' ? '易' : preferences.difficulty === 'hard' ? '难' : '中'}</p></div>}
        </section>
        <section className="panel agent-memory-card">
          <div className="agent-card-head"><h2>Agent 推断</h2><button onClick={() => setSummaryOpen(open => !open)}>{summaryOpen ? '收起' : '查看'}</button></div>
          <p className="muted">这是助手根据历史对话推断的内容，不是你填写的事实。</p>
          {summaryOpen && <><div className="agent-summary-text">{state?.agent_summary?.text ? <MathText text={state.agent_summary.text} /> : '暂无总结，完成几次学习任务后会逐步形成。'}</div><button className="text-button" onClick={clearSummary}>清除推断</button></>}
        </section>
        {state?.plans?.length ? <section className="panel agent-plans"><h2>学习计划</h2>{state.plans.map((plan: any) => <div className="agent-plan" key={plan.id}><div className="agent-plan-head"><strong>{plan.title}</strong>{plan.status === 'active' ? <button className="text-button" onClick={() => completePlan(plan.id)}>标记完成</button> : null}</div><span>{plan.items.length} 项 · {plan.status === 'active' ? '进行中' : plan.status === 'completed' ? '已完成' : '已归档'}</span>{plan.items.slice(0, 3).map((item: any, index: number) => <p key={index}>{item.title}{item.minutes ? ` · ${item.minutes} 分钟` : ''}</p>)}</div>)}</section> : null}
        {state?.tasks?.length ? <section className="panel agent-history"><h2>最近任务</h2>{state.tasks.slice(0, 5).map((task: any) => <button key={task.id} className={`agent-history-item ${activeTask?.id === task.id ? 'active' : ''}`} onClick={() => { setSelectedTaskId(task.id); setConversationId(task.conversation_id); }}><span>{task.goal}</span><small>{task.stage}</small></button>)}</section> : null}
      </aside>
      <section className="panel agent-workspace">
        {!aiConfigured && <div className="agent-notice"><span>使用 Agent 前需要配置模型服务。</span><button onClick={onOpenSettings}>去配置模型</button></div>}
        <div className="agent-suggestions"><button onClick={() => setGoal('根据我的错题和最近试卷，帮我安排今天的复习')}>安排今天的复习</button><button onClick={() => setGoal('帮我看看最近的错题，找最该补的知识点')}>找出最该补的知识点</button><button onClick={() => setGoal('根据我的情况生成一份适合的练习卷')}>生成适合的练习卷</button></div>
        <div className="agent-conversation">
          {messages.length === 0 && <div className="agent-empty"><strong>从一句目标开始</strong><p>例如：我今天有 1 小时，数学二想补积分，帮我安排。</p></div>}
          {messages.map((message, index) => <div className={`agent-message ${message.role}`} key={`${message.created_at || ''}-${index}`}>
            <div className="agent-avatar">{message.role === 'user' ? '你' : '研'}</div>
            <div className="agent-message-body">
              <div className="agent-message-name">{message.role === 'user' ? '你' : '学习助手'}</div>
              <div className="agent-bubble"><MathText text={formatAgentText(message.content || '')} /></div>
            </div>
          </div>)}
          {activeTask && activeTask.status !== 'succeeded' && <div className="agent-task-card">
            <div className="agent-task-head"><strong>{friendlyStage(activeTask.stage)}</strong>{running ? <ThinkingDots /> : null}</div>
            {activeTask.steps?.map((step: any) => <div className={`agent-step ${step.status}`} key={step.index}>
              <span className="agent-step-icon">{step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : '…'}</span>
              <div><b>{agentToolLabels[step.tool] || '处理学习任务'}</b><small>{step.status === 'running' ? '正在进行…' : step.result_summary || step.error || '已完成'}</small></div>
            </div>)}
            {!activeTask.steps?.length && running ? <div className="agent-thinking-line"><ThinkingDots /><span>正在理解你的目标并规划下一步…</span></div> : null}
          </div>}
          {busy && !running && <div className="agent-thinking-line"><ThinkingDots /><span>正在继续处理…</span></div>}
          {activeTask?.status === 'waiting_user' && activeTask.result?.requires_confirmation && <div className="agent-action-bar agent-confirm-bar"><span>助手需要你确认下一步</span><div><button className="primary small" onClick={() => confirmTask(activeTask.id, true)} disabled={busy}>确认执行</button><button onClick={() => confirmTask(activeTask.id, false)} disabled={busy}>暂不执行</button></div></div>}
          {['failed', 'degraded'].includes(activeTask?.status) && !hasAssistantReply && <div className="agent-error-note"><MathText text={activeTask.result?.reply || '学习助手暂时无法完成，请重试。'} /></div>}
          {activeTask?.status === 'cancelled' && <div className="agent-note">已取消本次操作，没有执行任何写入。</div>}
          {activeTask?.result?.artifacts?.length ? <div className="agent-action-bar artifact-actions">{activeTask.result.artifacts.map((artifact: any, index: number) => <button key={index} className="primary small" onClick={() => openArtifact(artifact)}>{artifact.type === 'paper' ? '打开试卷' : artifact.type === 'job' ? '查看出卷任务' : '查看计划'}</button>)}</div> : null}
        </div>
        <form className="agent-input" onSubmit={event => { event.preventDefault(); startGoal(); }}><textarea value={goal} onChange={e => setGoal(e.target.value)} placeholder="告诉助手你的目标、时间或薄弱点…" rows={3} /><div><span>会先读取你的档案和偏好，必要时调用工具。</span><button className="primary" disabled={busy}>{busy ? '执行中…' : '发送给学习助手'}</button></div></form>
      </section>
    </div>
    {error && <div className="error-banner">{error}<button onClick={() => setError('')}>知道了</button></div>}
  </section>;
}
