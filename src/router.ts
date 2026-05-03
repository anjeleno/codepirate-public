import type { Provider, RouterConfig, RequestOptions, ProviderPreset, StreamYield, UsageInfo } from './types'

// ─── Provider endpoint presets ────────────────────────────────────────────────

export const PROVIDER_PRESETS: Record<Provider, ProviderPreset> = {
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    isLocal: false,
  },
  'anthropic-direct': {
    label: 'Anthropic Direct',
    endpoint: 'https://api.anthropic.com/v1/messages',
    isLocal: false,
  },
  ollama: {
    label: 'Ollama (Local)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    isLocal: true,
  },
  lmstudio: {
    label: 'LM Studio (Local)',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    isLocal: true,
  },
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    isLocal: false,
  },
  together: {
    label: 'Together AI',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    isLocal: false,
  },
  mistral: {
    label: 'Mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    isLocal: false,
  },
  gemini: {
    label: 'Google Gemini (OpenAI compat)',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    isLocal: false,
  },
  custom: {
    label: 'Custom',
    endpoint: '',
    isLocal: false,
  },
}

export function resolveEndpoint(config: RouterConfig): string {
  if (config.provider === 'custom') {
    if (!config.apiEndpoint) {
      throw new Error('Custom provider requires codePirate.apiEndpoint to be set.')
    }
    return config.apiEndpoint
  }
  return PROVIDER_PRESETS[config.provider].endpoint
}

export function isLocal(provider: Provider): boolean {
  return PROVIDER_PRESETS[provider].isLocal
}

// ─── Thinking budget → token count ───────────────────────────────────────────

const THINKING_TOKENS: Record<string, number> = {
  medium: 4000,
  high: 16000,
  max: 32000,
}

// ─── Anthropic Direct adapter ─────────────────────────────────────────────────
// Translates an OpenAI-compat payload to Anthropic's /v1/messages schema.

function buildAnthropicRequest(
  options: RequestOptions,
  model: string,
): { body: string; headers: Record<string, string> } {
  const { messages, systemPrompt, maxTokens = 8192, thinkingBudget = 'off' } = options

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: options.stream,
  }

  if (thinkingBudget !== 'off' && THINKING_TOKENS[thinkingBudget]) {
    body['thinking'] = { type: 'enabled', budget_tokens: THINKING_TOKENS[thinkingBudget] }
    // Thinking requires at least budget_tokens + desired output tokens
    body['max_tokens'] = Math.max(maxTokens, THINKING_TOKENS[thinkingBudget] + 4096)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': '', // filled in by caller
    'anthropic-version': '2023-06-01',
  }

  return { body: JSON.stringify(body), headers }
}

// ─── OpenAI-compat request builder ───────────────────────────────────────────

function buildOpenAIRequest(
  options: RequestOptions,
  model: string,
  provider: Provider,
): { body: string; headers: Record<string, string> } {
  const { messages, systemPrompt, maxTokens = 8192, thinkingBudget = 'off' } = options

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model,
    messages: allMessages,
    max_tokens: maxTokens,
    stream: options.stream,
  }

  // Request usage in the final streaming chunk (OpenAI-compat spec).
  // Without this, many providers (OpenRouter, Groq, etc.) omit usage entirely
  // from streaming responses, leaving the Ledger at $0.
  if (options.stream) {
    body['stream_options'] = { include_usage: true }
  }

  // Pass thinking through for OpenRouter Claude models
  if (
    provider === 'openrouter' &&
    model.includes('claude') &&
    thinkingBudget !== 'off' &&
    THINKING_TOKENS[thinkingBudget]
  ) {
    body['thinking'] = { type: 'enabled', budget_tokens: THINKING_TOKENS[thinkingBudget] }
    body['max_tokens'] = Math.max(maxTokens, THINKING_TOKENS[thinkingBudget] + 4096)
  }

  // DeepSeek V4-Pro recommended sampling parameters per their model card.
  // Set explicitly — do not rely on OpenRouter defaults.
  if (model.includes('deepseek')) {
    body['temperature'] = 1.0
    body['top_p'] = 1.0
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: '', // filled in by caller
  }

  // OpenRouter requires these headers for attribution (good practice)
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://codepirate.cc'
    headers['X-Title'] = 'Code Pirate'
  }

  return { body: JSON.stringify(body), headers }
}

// ─── Main router ──────────────────────────────────────────────────────────────

export async function routeRequest(
  config: RouterConfig,
  options: RequestOptions,
): Promise<Response> {
  const endpoint = resolveEndpoint(config)
  const isAnthropic = config.provider === 'anthropic-direct'

  let requestBody: string
  let headers: Record<string, string>

  if (isAnthropic) {
    const built = buildAnthropicRequest(options, config.model)
    requestBody = built.body
    headers = built.headers
    headers['x-api-key'] = config.apiKey
  } else {
    const built = buildOpenAIRequest(options, config.model, config.provider)
    requestBody = built.body
    headers = built.headers
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: requestBody,
    signal: options.signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText)
    throw new RouterError(response.status, errorText, config.provider)
  }

  return response
}

// ─── Fallback chain ───────────────────────────────────────────────────────────

export async function routeWithFallback(
  configs: RouterConfig[],
  options: RequestOptions,
): Promise<{ response: Response; provider: Provider }> {
  const errors: string[] = []

  for (const config of configs) {
    try {
      const response = await routeRequest(config, options)
      return { response, provider: config.provider }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`[${config.provider}] ${msg}`)
      // Don't fall back on abort
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }
    }
  }

  throw new Error(`All providers failed:\n${errors.join('\n')}`)
}

// ─── Streaming parser ─────────────────────────────────────────────────────────

export async function* parseStream(
  response: Response,
  provider: Provider,
): AsyncGenerator<StreamYield> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Response body is not readable')
  }

  const decoder = new TextDecoder()
  const isAnthropic = provider === 'anthropic-direct'
  let buffer = ''
  const usage: UsageInfo = { inputTokens: 0, outputTokens: 0 }
  let reportedModel: string | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'event: ping') continue

        if (isAnthropic) {
          yield* parseAnthropicLine(trimmed, usage)
        } else {
          for (const event of parseOpenAILine(trimmed, usage)) {
            // Capture the first model ID reported by the provider (e.g. OpenRouter)
            if (event.type === 'model' && reportedModel === null) {
              reportedModel = event.id
            }
            yield event
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  yield { type: 'usage', usage }
}

function* parseOpenAILine(line: string, usage: UsageInfo): Generator<StreamYield> {
  if (!line.startsWith('data: ')) return
  const data = line.slice(6).trim()
  if (data === '[DONE]') return

  try {
    const parsed = JSON.parse(data)
    // Yield the model ID from the first chunk so callers can verify routing
    if (typeof parsed?.model === 'string' && parsed.model.length > 0) {
      yield { type: 'model', id: parsed.model }
    }
    const delta = parsed?.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) {
      yield { type: 'text', chunk: delta }
    }
    // Capture usage from final chunk
    if (parsed?.usage) {
      usage.inputTokens = parsed.usage.prompt_tokens ?? 0
      usage.outputTokens = parsed.usage.completion_tokens ?? 0
    }
  } catch {
    // Partial JSON — skip
  }
}

function* parseAnthropicLine(line: string, usage: UsageInfo): Generator<StreamYield> {
  if (!line.startsWith('data: ')) return
  const data = line.slice(6).trim()

  try {
    const parsed = JSON.parse(data)

    switch (parsed.type) {
      case 'content_block_delta': {
        const delta = parsed.delta
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          yield { type: 'text', chunk: delta.text }
        }
        if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          yield { type: 'thinking', chunk: delta.thinking }
        }
        break
      }
      case 'message_start': {
        const u = parsed.message?.usage
        if (u) {
          usage.inputTokens = u.input_tokens ?? 0
        }
        break
      }
      case 'message_delta': {
        const u = parsed.usage
        if (u) {
          usage.outputTokens = u.output_tokens ?? 0
        }
        break
      }
    }
  } catch {
    // Partial JSON — skip
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class RouterError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
    public readonly provider: Provider,
  ) {
    super(`${provider} returned HTTP ${statusCode}: ${responseBody.slice(0, 200)}`)
    this.name = 'RouterError'
  }
}
