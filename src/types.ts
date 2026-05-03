// ─── Shared types for the Code Pirate extension host ───────────────────────

export type Provider =
  | 'openrouter'
  | 'anthropic-direct'
  | 'ollama'
  | 'lmstudio'
  | 'groq'
  | 'together'
  | 'mistral'
  | 'gemini'
  | 'custom'

export type Persona = 'core' | 'diff' | 'snippet'

export type ThinkingBudget = 'off' | 'medium' | 'high' | 'max'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RouterConfig {
  provider: Provider
  model: string
  apiKey: string
  apiEndpoint?: string // only used when provider === 'custom'
}

export interface RequestOptions {
  messages: ChatMessage[]
  systemPrompt: string
  maxTokens?: number
  thinkingBudget?: ThinkingBudget
  stream: boolean
  signal?: AbortSignal
}

export type StreamYield =
  | { type: 'text'; chunk: string }
  | { type: 'thinking'; chunk: string }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'model'; id: string }

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
}

export interface FileChange {
  path: string
  content: string       // full file content (new files) OR replacement text (search/replace)
  search?: string       // if set: find this exact text and replace with content
  originalContent?: string
}

export interface VaultEntry {
  id: string
  name: string
  content: string
  createdAt: number
}

export interface SessionCost {
  inputTokens: number
  outputTokens: number
  costUsd: number
  savedVsCopilot: number
  model: string
}

export interface LicenseStatus {
  tier: 'free' | 'pro'
  expiresAt?: string
  cachedAt?: number
}

export interface ProviderPreset {
  label: string
  endpoint: string
  isLocal: boolean
}
