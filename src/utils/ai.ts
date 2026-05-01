export interface AIProvider {
  name: string
  apiUrl: string
  defaultModel: string
  models: string[]
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    name: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
  },
  {
    name: 'Claude',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-sonnet-20240229',
    models: ['claude-3-sonnet-20240229', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
  },
]

export interface AIGradeResult {
  overallScore: number
  comments: string
  details: {
    text: string
    isCorrect: boolean
    feedback: string
  }[]
}

export interface AISettings {
  provider: string
  apiKey: string
  model: string
}

const SETTINGS_KEY = 'pdfedit_ai_settings'

export function loadAISettings(): AISettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveAISettings(settings: AISettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function buildPrompt(answerText: string, studentText: string): string {
  return `你是资深教师，请对比标准答案和学生作业进行逐题批改。

【标准答案】
${answerText.slice(0, 4000)}

【学生作业】
${studentText.slice(0, 4000)}

请分析后返回严格 JSON 格式（不要 markdown 代码块）：
{
  "overallScore": 总分数字0到100,
  "comments": "总体评语，指出主要问题和优点",
  "details": [
    {
      "text": "学生作答中需要批改的具体文本片段",
      "isCorrect": true或false,
      "feedback": "对该片段的具体批改意见，错误时说明正确答案或扣分原因"
    }
  ]
}

details 数组中只需要列出有问题的或需要点评的关键片段，不需要列出所有正确内容。overallScore 是百分制整数。`
}

export async function aiGrade(
  settings: AISettings,
  answerText: string,
  studentText: string
): Promise<AIGradeResult> {
  const provider = AI_PROVIDERS.find(p => p.name === settings.provider) || AI_PROVIDERS[0]
  const prompt = buildPrompt(answerText, studentText)

  let responseText: string

  if (settings.provider === 'Claude') {
    const res = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.model || provider.defaultModel,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API error: ${res.status} ${err}`)
    }
    const data = await res.json()
    responseText = data.content?.[0]?.text || ''
  } else {
    // OpenAI
    const res = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || provider.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI API error: ${res.status} ${err}`)
    }
    const data = await res.json()
    responseText = data.choices?.[0]?.message?.content || ''
  }

  return parseAIGradeResult(responseText)
}

function parseAIGradeResult(text: string): AIGradeResult {
  // Try to extract JSON from markdown code block or raw text
  let jsonStr = text.trim()
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim()
  }
  // Sometimes the model wraps JSON in extra text
  const firstBrace = jsonStr.indexOf('{')
  const lastBrace = jsonStr.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1)
  }

  try {
    const parsed = JSON.parse(jsonStr)
    return {
      overallScore: Math.max(0, Math.min(100, Math.round(Number(parsed.overallScore) || 0))),
      comments: String(parsed.comments || ''),
      details: Array.isArray(parsed.details)
        ? parsed.details.map((d: any) => ({
            text: String(d.text || ''),
            isCorrect: Boolean(d.isCorrect),
            feedback: String(d.feedback || ''),
          }))
        : [],
    }
  } catch (e) {
    console.error('Failed to parse AI response:', text)
    return {
      overallScore: 0,
      comments: 'AI 返回格式解析失败，请重试。',
      details: [],
    }
  }
}

export async function aiComplete(
  settings: AISettings,
  existingText: string,
  context?: string
): Promise<string> {
  const provider = AI_PROVIDERS.find(p => p.name === settings.provider) || AI_PROVIDERS[0]
  const prompt = `请根据以下已有内容，继续补全或续写。只返回续写部分，不要重复已有内容，也不要添加解释。

${context ? '上下文：' + context + '\n\n' : ''}已有内容：
${existingText}

请续写：`

  let responseText: string

  if (settings.provider === 'Claude') {
    const res = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.model || provider.defaultModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API error: ${res.status} ${err}`)
    }
    const data = await res.json()
    responseText = data.content?.[0]?.text || ''
  } else {
    const res = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || provider.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI API error: ${res.status} ${err}`)
    }
    const data = await res.json()
    responseText = data.choices?.[0]?.message?.content || ''
  }

  // Clean up: remove quotes, "续写：" prefix, etc.
  let cleaned = responseText.trim()
  cleaned = cleaned.replace(/^['"]+|['"]+$/g, '')
  cleaned = cleaned.replace(/^续写[：:](\n)?/m, '')
  return cleaned.trim()
}
