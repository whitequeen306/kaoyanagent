import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import type { Cs408AgentMessage, Cs408AgentProfile, Cs408AgentState } from '../types';

const defaultProfile: Cs408AgentProfile = {
  subject: '408', exam_year: 2027, target_score: 120, foundation: '一般', stage: '强化',
  daily_minutes: 120, weak_points: [], notes: '',
};
const suggestions = [
  '根据我的 408 错题，安排今天 2 小时怎么练。',
  '分析我最薄弱的 408 章节，给出下一步。',
  '给我一份 7 天 408 冲刺计划。',
  '我数据结构图论总错，应该怎么补？',
];

export function Cs408AgentPanel({ aiConfigured, onOpenSettings }: { aiConfigured: boolean; onOpenSettings: () => void }) {
  const [profile, setProfile] = useState<Cs408AgentProfile>(defaultProfile);
  const [messages, setMessages] = useState<Cs408AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [weakPoints, setWeakPoints] = useState('');

  useEffect(() => {
    request<Cs408AgentState>('/api/cs408/agent')
      .then(data => {
        setProfile({ ...defaultProfile, ...data.profile });
        setWeakPoints((data.profile.weak_points || []).join('、'));
        setMessages(data.messages || []);
      })
      .catch(e => setError(e instanceof Error ? e.message : '408 助手加载失败'));
  }, []);

  async function saveProfile() {
    setBusy(true); setError(''); setSaved('');
    try {
      const data = await request<{ profile: Cs408AgentProfile }>('/api/cs408/agent/profile', { method: 'POST', body: { ...profile, weak_points: weakPoints.split(/[、,，]/).map(item => item.trim()).filter(Boolean) } });
      setProfile(data.profile);
      setWeakPoints((data.profile.weak_points || []).join('、'));
      setSaved('档案已保存。');
    } catch (e) { setError(e instanceof Error ? e.message : '档案保存失败'); }
    finally { setBusy(false); }
  }
  async function sendMessage(text = input) {
    const message = text.trim();
    if (!message || busy) return;
    if (!aiConfigured) { onOpenSettings(); return; }
    setBusy(true); setError(''); setSaved('');
    try {
      const data = await request<{ reply: string; messages: Cs408AgentMessage[] }>('/api/cs408/agent/chat', { method: 'POST', body: { message } });
      setMessages(data.messages || []);
      setInput('');
    } catch (e) { setError(e instanceof Error ? e.message : '408 助手回复失败'); }
    finally { setBusy(false); }
  }
  async function clearChat() {
    if (!window.confirm('清空 408 助手的对话记录？档案不会删除。')) return;
    setBusy(true);
    try {
      const data = await request<Cs408AgentState>('/api/cs408/agent/clear', { method: 'POST', body: {} });
      setMessages(data.messages || []);
    } catch (e) { setError(e instanceof Error ? e.message : '清空失败'); }
    finally { setBusy(false); }
  }

  return <section className="agent-layout cs408-agent-layout">
    <aside className="agent-sidebar">
      <div className="panel cs408-agent-profile">
        <span className="eyebrow">408 学习档案</span>
        <h2>让助手知道你的情况</h2>
        <div className="cs408-profile-fields">
          <label>考研年份<input type="number" value={profile.exam_year} onChange={event => setProfile(current => ({ ...current, exam_year: Number(event.target.value) }))} /></label>
          <label>目标分<input type="number" value={profile.target_score} onChange={event => setProfile(current => ({ ...current, target_score: Number(event.target.value) }))} /></label>
          <label>基础<select value={profile.foundation} onChange={event => setProfile(current => ({ ...current, foundation: event.target.value }))}><option>薄弱</option><option>一般</option><option>扎实</option></select></label>
          <label>阶段<select value={profile.stage} onChange={event => setProfile(current => ({ ...current, stage: event.target.value }))}><option>基础</option><option>强化</option><option>冲刺</option></select></label>
          <label>每天分钟<input type="number" value={profile.daily_minutes} onChange={event => setProfile(current => ({ ...current, daily_minutes: Number(event.target.value) }))} /></label>
          <label className="full">薄弱章节<input value={weakPoints} onChange={event => setWeakPoints(event.target.value)} placeholder="如：图、Cache、进程、TCP" /></label>
          <label className="full">备注<textarea rows={3} value={profile.notes} onChange={event => setProfile(current => ({ ...current, notes: event.target.value }))} placeholder="目标院校、复习习惯、当前进度…" /></label>
        </div>
        <button className="primary cs408-profile-save" disabled={busy} onClick={saveProfile}>保存 408 档案</button>
        {saved && <p className="cs408-agent-saved">{saved}</p>}
      </div>
      <div className="panel cs408-agent-note">
        <strong>助手会读什么</strong>
        <p>只读取这台设备的 408 档案、近期试卷、错题和章节得分率；不会编造题目或修改你的记录。</p>
      </div>
    </aside>
    <section className="panel agent-workspace cs408-agent-workspace">
      <div className="cs408-agent-head"><div><span className="eyebrow">408 · 学习助手</span><h1>今天 408 怎么学？</h1></div><button onClick={clearChat} disabled={busy || !messages.length}>清空对话</button></div>
      {!aiConfigured && <div className="agent-notice"><span>408 助手需要模型服务。</span><button onClick={onOpenSettings}>去配置模型</button></div>}
      {error && <div className="settings-status">{error}</div>}
      <div className="agent-suggestions">{suggestions.map(item => <button key={item} disabled={busy} onClick={() => sendMessage(item)}>{item}</button>)}</div>
      <div className="agent-conversation cs408-agent-conversation">
        {messages.length ? messages.map((message, index) => <div className={`agent-message ${message.role === 'user' ? 'user' : ''}`} key={`${message.role}-${index}-${message.created_at || ''}`}>
          <span className="agent-avatar">{message.role === 'user' ? '我' : '408'}</span>
          <div className="agent-message-body"><span className="agent-message-name">{message.role === 'user' ? '你' : '408 助手'}</span><div className="agent-bubble">{message.content}</div></div>
        </div>) : <div className="agent-empty"><strong>先说说你今天的目标</strong><p>例如：今天有 2 小时，想补数据结构的图，帮我安排。</p></div>}
      </div>
      <form className="agent-input" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
        <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="告诉 408 助手你的目标、时间或薄弱章节…" rows={3} />
        <div><span>会结合你的 408 试卷、错题和章节得分率回答。</span><button className="primary" disabled={busy || !input.trim()}>{busy ? '思考中…' : '发送给 408 助手'}</button></div>
      </form>
    </section>
  </section>;
}
