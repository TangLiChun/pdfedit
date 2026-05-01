import { useState, useEffect } from 'react'
import { AI_PROVIDERS, loadAISettings, saveAISettings, type AISettings } from '../utils/ai'

interface AiSettingsProps {
  onClose: () => void
}

export default function AiSettings({ onClose }: AiSettingsProps) {
  const [settings, setSettings] = useState<AISettings>({
    provider: 'OpenAI',
    apiKey: '',
    model: 'gpt-4o-mini',
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const loaded = loadAISettings()
    if (loaded) {
      setSettings(loaded)
    }
  }, [])

  const provider = AI_PROVIDERS.find(p => p.name === settings.provider) || AI_PROVIDERS[0]

  const handleSave = () => {
    saveAISettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-96 max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">AI 设置</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">服务商</label>
            <select
              value={settings.provider}
              onChange={e => {
                const p = AI_PROVIDERS.find(x => x.name === e.target.value)!
                setSettings({ ...settings, provider: p.name, model: p.defaultModel })
              }}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              {AI_PROVIDERS.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">模型</label>
            <div className="flex gap-2">
              <select
                value={provider.models.includes(settings.model) ? settings.model : '__custom__'}
                onChange={e => {
                  const v = e.target.value
                  if (v === '__custom__') {
                    setSettings({ ...settings, model: '' })
                  } else {
                    setSettings({ ...settings, model: v })
                  }
                }}
                className="border rounded px-3 py-2 text-sm"
              >
                {provider.models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">自定义...</option>
              </select>
              {!provider.models.includes(settings.model) && (
                <input
                  type="text"
                  value={settings.model}
                  onChange={e => setSettings({ ...settings, model: e.target.value })}
                  placeholder="输入模型名称"
                  className="flex-1 border rounded px-3 py-2 text-sm"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={settings.apiKey}
              onChange={e => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder="sk-... 或 sk-ant-..."
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">API Key 仅保存在本地浏览器中</p>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={handleSave}
            className={`flex-1 px-4 py-2 rounded text-white transition ${saved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {saved ? '已保存' : '保存'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded hover:bg-gray-50 transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
