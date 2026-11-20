import {
  AI_QUESTION_CONFIDENCE_DECAY,
  AI_QUESTION_INITIAL_CONFIDENCE,
} from './model.mjs';

function clampConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return AI_QUESTION_INITIAL_CONFIDENCE;
  return Math.max(0, Math.min(AI_QUESTION_INITIAL_CONFIDENCE, Math.trunc(parsed)));
}

export function normalizeAiQuestion(question) {
  if (question.source !== 'ai') return question;
  return { ...question, confidence: clampConfidence(question.confidence) };
}

export function normalizeAiQuestions(questions) {
  return questions.map(normalizeAiQuestion);
}

function matchesSlot(question, slot, reservedIds, selectedIds) {
  if (question.source !== 'ai' || question.is_fixture || question.status !== 'published') return false;
  if (question.qtype !== slot.qtype || question.difficulty !== slot.difficulty) return false;
  if (reservedIds.has(question.id) || selectedIds.has(question.id)) return false;
  if (slot.variantOf) {
    if (question.generator_meta_json?.variant_of !== slot.variantOf) return false;
  } else if (question.generator_meta_json?.variant_of) {
    return false;
  }
  return (question.knowledge || []).some(node => slot.allowedCodes.includes(node.code));
}

function compareConfidence(left, right) {
  return clampConfidence(right.confidence) - clampConfidence(left.confidence)
    || String(left.id).localeCompare(String(right.id));
}

function candidatesForSlot(runtime, slot, reservedIds, selectedIds) {
  return runtime.questions
    .filter(question => matchesSlot(question, slot, reservedIds, selectedIds))
    .sort(compareConfidence);
}

export function planReusableAiQuestions(runtime, jobId, slots) {
  runtime.aiQuestionReservations ||= new Map();
  const reservedIds = new Set(runtime.aiQuestionReservations.keys());
  const selectedIds = new Set();
  const reused = [];
  const toGenerate = [];
  const random = runtime.random || Math.random;

  for (const slot of slots) {
    const candidates = candidatesForSlot(runtime, slot, reservedIds, selectedIds);
    const selected = candidates.length && random() < 0.5 ? candidates[0] : null;
    if (!selected) {
      toGenerate.push(slot);
      continue;
    }
    selectedIds.add(selected.id);
    reservedIds.add(selected.id);
    runtime.aiQuestionReservations.set(selected.id, jobId);
    reused.push({ question: selected, slot });
  }

  return { reused, toGenerate };
}

export function commitReusableAiQuestions(runtime, jobId, questionIds) {
  for (const questionId of questionIds) {
    const question = runtime.questions.find(item => item.id === questionId);
    if (question?.source === 'ai') {
      question.confidence = Math.max(0, clampConfidence(question.confidence) - AI_QUESTION_CONFIDENCE_DECAY);
    }
    if (runtime.aiQuestionReservations?.get(questionId) === jobId) {
      runtime.aiQuestionReservations.delete(questionId);
    }
  }
}

export function releaseReusableAiQuestions(runtime, jobId, questionIds) {
  for (const questionId of questionIds) {
    if (runtime.aiQuestionReservations?.get(questionId) === jobId) {
      runtime.aiQuestionReservations.delete(questionId);
    }
  }
}
