// ─── Shared types between extension host and webview ─────────────────────────

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
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp: number
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

export interface ProviderInfo {
  id: Provider
  label: string
  isLocal: boolean
}

export interface ModelInfo {
  id: string
  name: string
  contextLength: number
  promptCostPer1k: number   // USD per 1k input tokens
  completionCostPer1k: number
  provider: string          // e.g. "anthropic", "openai"
}

// ─── Extension → Webview messages ─────────────────────────────────────────────

export interface InitialState {
  provider: Provider
  model: string
  hasApiKey: boolean
  tier: 'free' | 'pro'
  ledger: SessionCost
  vaultEntries: VaultEntry[]
  providers: ProviderInfo[]
  streaming?: boolean
}

export type ExtensionMessage =
  | { type: 'initialized'; state: InitialState }
  | { type: 'streamChunk'; text: string }
  | { type: 'thinkingChunk'; text: string }
  | { type: 'streamEnd'; thinking?: string }
  | { type: 'streamError'; error: string }
  | { type: 'ledgerUpdate'; ledger: SessionCost }
  | { type: 'vaultEntries'; entries: VaultEntry[] }
  | { type: 'licenseStatus'; tier: 'free' | 'pro'; expiresAt?: string }
  | { type: 'diffReady'; count: number; files: string[] }
  | { type: 'diffApplied'; applied: string[]; failed: string[] }
  | { type: 'apiKeySet'; hasKey: boolean }
  | { type: 'modelsLoaded'; models: ModelInfo[] }
  | { type: 'creditBalance'; balance: number }
  | { type: 'filePicked'; path: string; name: string }
  | { type: 'activeFileChanged'; name: string | null }
  | { type: 'workspaceTokens'; tokens: number }
  | { type: 'buildPaused' }
  | { type: 'error'; message: string }
  // Emitted for each tool call during the agent loop — drives the real-time
  // progress display in the chat ("Editing src/foo.ts…", "Read src/bar.ts")
  | { type: 'toolProgress'; toolName: string; args: Record<string, unknown>; status: 'running' | 'done' | 'error'; result: string }

// ─── Webview → Extension messages ─────────────────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'chat'; message: string; persona: Persona; thinkingBudget: ThinkingBudget; includeWorkspace: boolean }
  | { type: 'setApiKey'; key: string }
  | { type: 'setProvider'; provider: Provider }
  | { type: 'setModel'; model: string }
  | { type: 'cancelStream' }
  | { type: 'previewDiff' }
  | { type: 'applyDiff' }
  | { type: 'rejectDiff' }
  | { type: 'saveVaultEntry'; name: string; content: string }
  | { type: 'deleteVaultEntry'; id: string }
  | { type: 'activateLicense'; key: string }
  | { type: 'clearHistory' }
  | { type: 'estimateWorkspaceTokens' }
