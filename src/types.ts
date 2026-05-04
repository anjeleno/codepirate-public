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

export type Persona = 'core' | 'diff' | 'snippet' | 'planner'

export type ThinkingBudget = 'off' | 'medium' | 'high' | 'max'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  // Present on assistant messages that include tool calls (agent loop)
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  // Present on tool result messages (role === 'tool')
  toolCallId?: string
}

export interface RouterConfig {
  provider: Provider
  model: string
  apiKey: string
  apiEndpoint?: string // only used when provider === 'custom'
  openrouterIgnoreProviders?: string[]
  openrouterRequireProviders?: string[]
}

// ─── Tool-calling types ───────────────────────────────────────────────────────

/** JSON Schema object describing one tool the model may call. */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** A fully-parsed, ready-to-execute tool invocation from the model. */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

// ─── Request / stream types ───────────────────────────────────────────────────

export interface RequestOptions {
  messages: ChatMessage[]
  systemPrompt: string
  maxTokens?: number
  thinkingBudget?: ThinkingBudget
  stream: boolean
  signal?: AbortSignal
  tools?: ToolDefinition[]   // when set, enables tool-calling on supported providers
}

export type StreamYield =
  | { type: 'text'; chunk: string }
  | { type: 'thinking'; chunk: string }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'model'; id: string }
  | { type: 'tool_call'; call: ToolCall }  // yielded after stream ends if model called tools

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
}

export interface FileChange {
  path: string
  content: string         // full file content (new files) OR replacement/inserted text
  search?: string         // if set: find this exact text and replace with content
  insertAfterLine?: number // if set: insert content after this 1-based line number (no search needed)
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
