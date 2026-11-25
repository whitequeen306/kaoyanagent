import { useState } from 'react';
import { request } from '../lib/api';

export function useAiSettings() {
  const [aiSettings, setAiSettings] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ base_url: '', api_key: '', model: '' });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  function openSettings() {
    setSettingsForm(current => ({ base_url: aiSettings?.base_url || '', api_key: current.api_key || '', model: aiSettings?.model || '' }));
    setSettingsSuccess(false);
    setSettingsMessage(aiSettings?.configured ? '已保存配置，修改后需要重新测试。' : '支持 OpenAI 兼容接口，保存前会真实调用测试。');
    setSettingsOpen(true);
  }

  async function saveAiSettings() {
    setSettingsBusy(true);
    setSettingsSuccess(false);
    setSettingsMessage('正在测试模型连接…');
    try {
      const data = await request<any>('/api/ai-settings', { method: 'POST', body: settingsForm });
      setAiSettings(data.settings);
      setSettingsSuccess(true);
      setSettingsMessage(`连接正常（${data.latency_ms}ms），配置已保存。`);
    } catch (e) {
      setSettingsMessage(e instanceof Error ? e.message : '模型连接测试失败');
    } finally {
      setSettingsBusy(false);
    }
  }

  return {
    aiSettings, setAiSettings,
    settingsOpen, setSettingsOpen, settingsForm, setSettingsForm,
    settingsBusy, settingsMessage, settingsSuccess,
    openSettings, saveAiSettings,
  };
}
