export function SettingsModal({ open, busy, form, message, success, hasKey, keyHint, onClose, onChange, onSave }: {
  open: boolean;
  busy: boolean;
  form: { base_url: string; api_key: string; model: string };
  message: string;
  success: boolean;
  hasKey: boolean;
  keyHint: string;
  onClose: () => void;
  onChange: (patch: Partial<{ base_url: string; api_key: string; model: string }>) => void;
  onSave: () => void;
}) {
  if (!open) return null;
  return <div className="modal-backdrop no-print" role="dialog" aria-modal="true" aria-label="模型设置" onClick={() => { if (!busy) onClose(); }}><div className="settings-card" onClick={event => event.stopPropagation()}>
    <span className="eyebrow">模型服务</span><h2>配置模型提供商</h2>
    <p>支持 OpenAI 兼容接口。Base URL 填到 <code>/v1</code>，例如 <code>https://api.openai.com/v1</code>。API Key 只保存在服务端，不会回传浏览器。</p>
    <div className="settings-fields">
      <label>Base URL<input value={form.base_url} onChange={event => onChange({ base_url: event.target.value })} placeholder="https://api.openai.com/v1" /></label>
      <label>API Key<input type="password" value={form.api_key} onChange={event => onChange({ api_key: event.target.value })} placeholder={hasKey ? `已保存 ${keyHint}，留空不修改` : 'sk-...'} /></label>
      <label>模型<input value={form.model} onChange={event => onChange({ model: event.target.value })} placeholder="gpt-4o-mini / deepseek-chat" /></label>
    </div>
    {message && <div className={`settings-status ${success ? 'success' : ''}`}>{message}</div>}
    <div className="modal-actions"><button onClick={onClose} disabled={busy}>关闭</button><button className="primary" onClick={onSave} disabled={busy}>{busy ? '正在测试…' : '保存并测试'}</button></div>
  </div></div>;
}
