import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import type { DailyAnswerImage, DailyQuestionState } from '../types';

export function useDailyQuestion({ openSettings, aiConfigured, onError }: {
  openSettings: () => void;
  aiConfigured: boolean;
  onError: (message: string) => void;
}) {
  const [question, setQuestion] = useState<DailyQuestionState | null>(null);
  const [answer, setAnswer] = useState('');
  const [answerImage, setAnswerImage] = useState<DailyAnswerImage | null>(null);
  const [error, setDailyError] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const imageReadVersion = useRef(0);

  useEffect(() => {
    request<DailyQuestionState>('/api/daily-question').then(data => {
      setQuestion(data);
      setAnswer(data.result?.answer_raw ?? '');
      setAnswerImage(null);
    }).catch(() => {});
  }, []);

  function selectImage(file: File) {
    if (busy) return;
    const version = ++imageReadVersion.current;
    setAnswerImage(null);
    setReading(false);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setDailyError('只支持 PNG、JPG 或 WebP 图片。'); return; }
    if (!file.size || file.size > 4 * 1024 * 1024) { setDailyError('请选择非空且不超过 4 MB 的图片。'); return; }
    setDailyError('');
    setReading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (version !== imageReadVersion.current) return;
      setReading(false);
      if (reader.error || typeof reader.result !== 'string') { setDailyError('图片读取失败，请重新选择。'); return; }
      setAnswerImage({ mime_type: file.type as DailyAnswerImage['mime_type'], data_url: reader.result, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!question || busy || reading || (!answer.trim() && !answerImage)) return;
    setBusy(true); setDailyError('');
    try {
      const data = await request<DailyQuestionState>('/api/daily-question/submit', { method: 'POST', body: {
        date: question.date, question_id: question.question.id,
        answer_raw: answer,
        answer_image: answerImage ? { mime_type: answerImage.mime_type, data_url: answerImage.data_url } : undefined,
      } });
      setQuestion(data);
      if (data.status === 'submitted' && !data.result?.retryable) setAnswerImage(null);
    } catch (e) { setDailyError(e instanceof Error ? e.message : '每日题判定失败，请重试。'); }
    finally { setBusy(false); }
  }

  async function askAi(prompt: string) {
    if (!question) return;
    setAiBusy(true); onError('');
    try {
      const data = await request<DailyQuestionState>('/api/daily-question/explain', { method: 'POST', body: { date: question.date, prompt } });
      setQuestion(data);
      setAiPrompt('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'AI 讲解失败');
      if (!aiConfigured) openSettings();
    } finally { setAiBusy(false); }
  }

  return {
    daily: {
      question, answer, answerImage, busy, reading, error, aiBusy, aiPrompt,
      onAnswerChange: setAnswer,
      onImageSelect: selectImage,
      onImageRemove: () => setAnswerImage(null),
      onSubmit: submit,
      onAiPromptChange: setAiPrompt,
      onAiAsk: askAi,
    },
  };
}
