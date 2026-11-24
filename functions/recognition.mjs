import { fail } from './model.mjs';
import { providerFor } from './ai-settings.mjs';
import { checkQuota } from './runtime.mjs';
import { takeImageAsset } from './image-assets.mjs';

function parseRecognition(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) fail('ai_invalid_json', 502);
  let parsed;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { fail('ai_invalid_json', 502); }
  const recognized = String(parsed?.recognized_latex ?? parsed?.latex ?? '').trim();
  if (!recognized || recognized.length > 4000) fail('ai_invalid_json', 502);
  const confidence = Number(parsed?.confidence);
  return {
    recognized_latex: recognized,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : 0,
    needs_confirmation: parsed?.needs_confirmation !== false,
  };
}

export async function recognizeAnswer(runtime, deviceId, input) {
  const question = runtime.questions.find(item => item.id === String(input.question_id || '') && item.status === 'published');
  if (!question) fail('not_found', 404);
  if (!['fill_blank', 'free_response'].includes(question.qtype)) fail('invalid_input');
  const provider = providerFor(runtime, deviceId);
  if (!provider) fail('llm_not_configured', 409);
  if (!checkQuota(runtime, deviceId, 1)) fail('quota_exceeded', 429);
  const asset = takeImageAsset(runtime, deviceId, input.image_asset_id);
  const context = {
    question: question.stem_latex,
    sub_items: question.sub_items_json || [],
    qtype: question.qtype,
  };
  const reply = await provider([
    { role: 'system', content: '你是考研数学手写答案转写器。只把图片中的学生手写解答转成 LaTeX，不要判分，不要补写学生没写的内容。看不清的字符用 \square 表示。只输出 JSON：{"recognized_latex":"...","confidence":0-100,"needs_confirmation":true}。不要输出代码块。' },
    { role: 'user', content: [
      { type: 'text', text: `题目上下文：${JSON.stringify(context)}` },
      { type: 'image_url', image_url: { url: asset.data_url } },
    ] },
  ], { maxTokens: 1200, temperature: 0.1 });
  return parseRecognition(reply);
}
