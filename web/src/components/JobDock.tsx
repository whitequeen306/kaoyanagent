import type { JobTask } from '../hooks/useJobQueue';

const jobPhaseIndex: Record<string, number> = { queued: -1, generating: 0, format_check: 1, self_test: 2, assembling: 3, done: 4 };
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

export function JobDock({ jobs, open, onToggle, onOpenPaper, onDismiss }: {
  jobs: JobTask[];
  open: boolean;
  onToggle: () => void;
  onOpenPaper: (task: JobTask) => void;
  onDismiss: (id: string) => void;
}) {
  if (!jobs.length) return null;
  const active = jobs.filter(task => task.status === 'running').length;
  const queued = jobs.filter(task => task.status === 'queued').length;
  const completed = jobs.filter(task => task.status === 'succeeded').length;
  return <aside className="job-dock no-print" aria-live="polite">
    <button className="job-dock-head" onClick={onToggle}>
      <span className={`job-pulse ${active ? 'active' : ''}`} />
      <span className="job-dock-title"><strong>出卷队列</strong><small>{active} 进行中 · {queued} 排队{completed ? ` · ${completed} 已完成` : ''}</small></span>
      <span className="job-dock-toggle">{open ? '收起' : '展开'}</span>
    </button>
    {open && <div className="job-dock-list">
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
          {task.status === 'succeeded' && <div className="job-item-actions"><button className="primary small" onClick={() => onOpenPaper(task)}>查看试卷</button><button className="job-dismiss" onClick={() => onDismiss(task.id)}>移除</button></div>}
          {task.status === 'failed' && <div className="job-error"><span>{message}</span><button className="job-dismiss" onClick={() => onDismiss(task.id)}>移除</button></div>}
        </div>;
      })}
      <p className="job-dock-note">同时生成 2 张，其余自动排队；期间可继续组卷。</p>
    </div>}
  </aside>;
}
