// Shared types and invariants for the local and deployed application.
export const QTYPES = new Set(['single_choice', 'fill_blank', 'free_response']);
export const SOURCE_MODES = new Set(['real', 'ai', 'mixed']);
export const MODES = new Set(['exam', 'drill']);
export const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
export const MAX_QUESTIONS = 30;
export const AI_QUESTION_INITIAL_CONFIDENCE = 100;
export const AI_QUESTION_CONFIDENCE_DECAY = 1;

export class AppError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const fail = (code, status = 400) => { throw new AppError(code, status); };
export const uuid = () => globalThis.crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export function assertDeviceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{12,96}$/.test(value)) fail('unauthorized_device', 401);
}
export function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff+\-*/=<>≤≥]+/g, '').trim();
}
export function questionScore(question) { return question.score_x2; }
export function paperScore(items) { return items.reduce((sum, item) => sum + questionScore(item.question), 0); }
