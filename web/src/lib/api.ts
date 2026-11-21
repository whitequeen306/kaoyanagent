export const DEVICE_KEY = 'kaoyan-device-id';
export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = `dev_${crypto.randomUUID().replaceAll('-', '')}`; localStorage.setItem(DEVICE_KEY, id); }
  return id;
}
const messages: Record<string, string> = {
  insufficient_questions: '当前知识范围内符合条件的题目不足，请减少题量或放宽筛选。',
  quota_exceeded: '今日生成额度已用完，请明天再试或使用真题。',
  unauthorized_device: '设备身份无效，请刷新页面重新开始。',
  idempotency_conflict: '相同请求标识对应了不同内容，请刷新后重试。',
  state_conflict: '当前每日题状态已变化，请刷新后重试。',
  invalid_input: '提交的内容不完整或格式不正确。',
  not_found: '找不到这张试卷或这道题，可能已过期。',
  not_mastered: '这套仿真题还没有全部答对，掌握度达到 100% 后才能移出错题本。',
  ai_variant_type_mismatch: '仿真题题型与原错题不一致，请重试。',
  llm_not_configured: '无法连接模型，请确认已配置模型',
  llm_unreachable: '无法连接模型，请确认已配置模型',
  llm_upstream_error: '无法连接模型，请确认已配置模型',
  ai_invalid_json: '模型返回的判断格式异常，请重试。',
  llm_empty_response: '模型没有返回内容，请确认模型名称正确。',
  model_unavailable: '模型服务暂不可用，请稍后重试。',
  internal_error: '服务内部错误，请稍后重试。',
};
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiEndpoint = (path: string) => `${apiBaseUrl}/functions/v1/app${path}`;
let sessionPromise: Promise<string> | null = null;
async function sessionToken(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = fetch(apiEndpoint('/api/session'), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': deviceId() },
      body: JSON.stringify({ device_id: deviceId() }),
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error('设备会话创建失败，请刷新重试。');
      return data.token as string;
    }).catch(error => { sessionPromise = null; throw error; });
  }
  return sessionPromise;
}
export async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method || 'GET';
  const token = method === 'GET' ? null : await sessionToken();
  const response = await fetch(apiEndpoint(path), {
    method,
    headers: {
      'x-device-id': deviceId(),
      ...(token ? { 'x-device-token': token } : {}),
      ...(method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: method !== 'GET' ? JSON.stringify({ ...(options.body as object || {}), device_id: deviceId() }) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const code = data?.error?.code;
    if (path === '/api/daily-question/submit' && code === 'llm_not_configured') {
      throw new Error('这次作答需要模型判定。请打开模型设置，保存配置后重新提交。');
    }
    throw new Error(messages[code] || '服务暂时不可用');
  }
  return data as T;
}
export const formatScore = (x2: number) => Number.isInteger(x2 / 2) ? String(x2 / 2) : (x2 / 2).toFixed(1);
export const difficultyLabel = (value: string) => ({ easy: '易', medium: '中', hard: '难' }[value] || value);
