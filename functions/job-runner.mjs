import { advancePaperJob, advanceVariantJob } from './generate.mjs';
import { advanceCs408PaperJob } from './cs408-generate.mjs';
import { advanceGradingJob } from './paper-grading.mjs';

const RUNNABLE = ['queued', 'generating', 'verifying'];
const runners = new WeakMap();

export function isRunnableJob(job) {
  return Boolean(job) && RUNNABLE.includes(job.status);
}

function advanceJob(runtime, job) {
  if (job.kind === 'variant') return advanceVariantJob(runtime, job);
  if (job.kind === 'cs408_paper') return advanceCs408PaperJob(runtime, job);
  if (job.kind === 'grading') return advanceGradingJob(runtime, job);
  return advancePaperJob(runtime, job);
}

function activeJobs(runtime) {
  return (runtime.jobs || []).filter(isRunnableJob);
}

async function tick(runtime) {
  const state = runners.get(runtime);
  if (!state || state.running) return;
  state.running = true;
  try {
    const jobs = activeJobs(runtime).slice(0, state.concurrency);
    if (jobs.length) {
      await Promise.all(jobs.map(async job => {
        try { await advanceJob(runtime, job); } catch {}
      }));
      state.changed = true;
    }
  } finally {
    state.running = false;
  }
  if (state.changed) {
    state.changed = false;
    try { await state.onChange?.(); } catch {}
  }
  if (activeJobs(runtime).length) schedule(runtime, state.interval);
}

function schedule(runtime, delay) {
  const state = runners.get(runtime);
  if (!state || state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void tick(runtime);
  }, delay);
  state.timer?.unref?.();
}

export function startJobRunner(runtime, { onChange = null, interval = 900 } = {}) {
  if (runners.has(runtime)) return;
  runners.set(runtime, { running: false, timer: null, changed: false, onChange, interval, concurrency: 2 });
  schedule(runtime, 200);
}

export function kickJobs(runtime) {
  if (!runners.has(runtime)) return;
  schedule(runtime, 50);
}
