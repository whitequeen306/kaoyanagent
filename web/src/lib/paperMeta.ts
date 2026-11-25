import type { Qtype, SourceMode } from '../types';

export const qtypeOptions: { value: Qtype; label: string }[] = [
  { value: 'single_choice', label: '选择题' }, { value: 'fill_blank', label: '填空题' }, { value: 'free_response', label: '解答题' },
];

export const sourceOptions: { value: SourceMode; label: string; note: string }[] = [
  { value: 'real', label: '真题', note: '从历年真题中抽题' },
  { value: 'ai', label: 'AI 仿真', note: '生成并校验新题' },
  { value: 'mixed', label: '混合', note: '目标真题与 AI 各半' },
];

export const qtypeLabel = (value: Qtype) => qtypeOptions.find(item => item.value === value)?.label || value;
export const sourceLabel = (value: string) => sourceOptions.find(item => item.value === value)?.label || value;
export const paperOriginKey = (paper: any) => paper.origin === 'repair' ? 'repair' : paper.origin === 'variant' ? 'variant' : paper.origin === 'math_exam' ? 'exam' : 'free';
export const paperOriginLabel = (paper: any) => paperOriginKey(paper) === 'repair' ? '错题修复' : paperOriginKey(paper) === 'variant' ? '错题仿真' : paperOriginKey(paper) === 'exam' ? '真题整卷' : '自由练习';
export const wrongRepairGroup = (item: any) => {
  if ((item.repair?.repair_passes || 0) >= 5 || item.repair?.status === 'completed') return 'mastered';
  if (['generating', 'ready', 'needs_retry', 'passed'].includes(item.repair?.status)) return 'repairing';
  return 'needs_repair';
};
export const wrongPassBucket = (item: any) => {
  const passes = item.repair?.repair_passes || 0;
  if (passes === 0) return '0';
  if (passes <= 2) return '1-2';
  if (passes <= 4) return '3-4';
  return '5';
};
