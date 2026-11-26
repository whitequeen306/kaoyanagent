import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import type { Paper } from '../types';

export type JobTask = {
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

const MAX_ACTIVE_JOBS = 2;

export function useJobQueue() {
  const [jobs, setJobs] = useState<JobTask[]>([]);
  const [jobsOpen, setJobsOpen] = useState(false);
  const startedJobs = useRef(new Set<string>());
  const activeJobCount = jobs.filter(task => task.status === 'running').length;
  const queuedJobCount = jobs.filter(task => task.status === 'queued').length;
  const completedJobCount = jobs.filter(task => task.status === 'succeeded').length;

  useEffect(() => {
    if (activeJobCount >= MAX_ACTIVE_JOBS) return;
    const next = jobs.find(task => task.status === 'queued' && !startedJobs.current.has(task.id));
    if (!next) return;
    startedJobs.current.add(next.id);
    void runJob(next.id);
  }, [jobs, activeJobCount]);

  useEffect(() => {
    let cancelled = false;
    request<{ items: any[] }>('/api/jobs').then(({ items }) => {
      if (cancelled) return;
      const restored = (items || [])
        .filter(job => job.kind !== 'grading' && ['queued', 'generating', 'verifying'].includes(job.status))
        .map(job => ({
          id: job.id, status: 'queued' as const, stage: job.stage || '排队中', progress: job.progress || 0,
          requestLabel: job.kind === 'variant' ? 'AI 修复 · 错题变式' : job.kind === 'cs408_paper' ? '408 AI 出卷' : 'AI 仿真组卷',
          detail: job.detail || '任务在服务端继续推进…', phase: job.phase,
          expectedCount: job.expected_count || 0, generatedCount: job.generated_count || 0,
          verifiedCount: job.verified_count || 0, reusedCount: job.reused_count || 0,
        }));
      if (!restored.length) return;
      setJobs(list => {
        const known = new Set(list.map(task => task.id));
        return [...list, ...restored.filter((task: JobTask) => !known.has(task.id))];
      });
      setJobsOpen(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

  function enqueueJob(job: JobTask) {
    if (startedJobs.current.has(job.id)) return;
    setJobs(list => [...list, job]);
    setJobsOpen(true);
  }
  function dismissJob(id: string) {
    setJobs(list => list.filter(item => item.id !== id));
  }

  return {
    jobs, setJobs, jobsOpen, setJobsOpen, startedJobs,
    activeJobCount, queuedJobCount, completedJobCount,
    enqueueJob, dismissJob,
  };
}
