import React, { useEffect, useReducer, useRef, useCallback, useState, useMemo } from 'react'
import { postMessage } from './vscode'
import type {
  ExtensionMessage,
  ChatMessage,
  VaultEntry,
  SessionCost,
  Provider,
  Persona,
  ThinkingBudget,
  ProviderInfo,
  ModelInfo,
  InitialState,
} from './types'
import { MessageList } from './components/MessageList'
import { PersonaSwitcher } from './components/PersonaSwitcher'
import { ThinkingDial } from './components/ThinkingDial'
import { ProviderSelector, STATIC_MODELS } from './components/ProviderSelector'
import { Ledger } from './components/Ledger'
import { VaultPanel } from './components/VaultPanel'
// ─── Chat session history ──────────────────────────────────────────────────────────────

interface SavedSession {
  id: string
  title: string
  messages: ChatMessage[]
  savedAt: number
}

const SESSIONS_KEY = 'codePirate.sessions'

// ─── Slash commands ───────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { id: '/fix',     desc: 'Fix issues in the active file or selection' },
  { id: '/explain', desc: 'Explain what the active file does' },
  { id: '/tests',   desc: 'Write unit tests for the active file' },
  { id: '/doc',     desc: 'Add documentation to the active file' },
]

const SLASH_PROMPTS: Record<string, string> = {
  '/fix':     'Review and fix any bugs, errors, or issues in the following code.',
  '/explain': 'Explain what the following code does, how it works, and any important patterns or edge cases.',
  '/tests':   'Write comprehensive unit tests for the following code. Cover happy paths, edge cases, and error cases. Use the appropriate test framework for this project.',
  '/doc':     'Add clear, comprehensive documentation comments to the following code. Use the appropriate comment format for the language.',
}
// ─── App state ────────────────────────────────────────────────────────────────

interface DiffState {
  count: number
  files: string[]
}

interface AppState {
  initialized: boolean
  messages: ChatMessage[]
  streamingText: string
  streamingThinking: string
  streaming: boolean
  error: string | null
  persona: Persona
  thinkingBudget: ThinkingBudget
  includeWorkspace: boolean
  provider: Provider
  model: string
  hasApiKey: boolean
  tier: 'free' | 'pro'
  ledger: SessionCost
  vaultEntries: VaultEntry[]
  providers: ProviderInfo[]
  models: ModelInfo[]
  activeTab: 'chat' | 'vault' | 'settings' | 'history'
  pendingDiff: DiffState | null
  input: string
  creditBalance: number | null
  savedSessions: SavedSession[]
  workspaceTokens: number | null // null = not yet estimated
  activeFileName: string | null
  attachedFiles: Array<{ path: string; name: string }>
  isCoreBuilding: boolean
  buildPaused: boolean
}

const emptyLedger: SessionCost = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  savedVsCopilot: 0,
  model: '',
}

const initialState: AppState = {
  initialized: false,
  messages: [],
  streamingText: '',
  streamingThinking: '',
  streaming: false,
  error: null,
  persona: 'core',
  thinkingBudget: 'off',
  includeWorkspace: false,
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-pro',
  hasApiKey: false,
  tier: 'free',
  ledger: emptyLedger,
  vaultEntries: [],
  providers: [],
  models: [],
  activeTab: 'chat',
  pendingDiff: null,
  input: '',
  creditBalance: null,
  savedSessions: [],
  workspaceTokens: null,
  activeFileName: null,
  attachedFiles: [],
  isCoreBuilding: false,
  buildPaused: false,
}

type Action =
  | { type: 'INITIALIZED'; state: InitialState }
  | { type: 'STREAM_CHUNK'; text: string }
  | { type: 'THINKING_CHUNK'; text: string }
  | { type: 'STREAM_END'; thinking?: string }
  | { type: 'STREAM_ERROR'; error: string }
  | { type: 'LEDGER_UPDATE'; ledger: SessionCost }
  | { type: 'VAULT_ENTRIES'; entries: VaultEntry[] }
  | { type: 'LICENSE_STATUS'; tier: 'free' | 'pro' }
  | { type: 'DIFF_READY'; count: number; files: string[] }
  | { type: 'DIFF_APPLIED'; applied: string[]; failed: string[] }
  | { type: 'API_KEY_SET'; hasKey: boolean }
  | { type: 'MODELS_LOADED'; models: ModelInfo[] }
  | { type: 'SET_PERSONA'; persona: Persona }
  | { type: 'SET_THINKING'; budget: ThinkingBudget }
  | { type: 'SET_WORKSPACE'; include: boolean }
  | { type: 'SET_PROVIDER'; provider: Provider }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_TAB'; tab: AppState['activeTab'] }
  | { type: 'SET_INPUT'; input: string }
  | { type: 'SEND_MESSAGE' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'CREDIT_BALANCE'; balance: number }
  | { type: 'NEW_CHAT' }
  | { type: 'RESTORE_SESSION'; session: SavedSession }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'LOAD_SESSIONS'; sessions: SavedSession[] }
  | { type: 'WORKSPACE_TOKENS'; tokens: number | null }
  | { type: 'ACTIVE_FILE_CHANGED'; name: string | null }
  | { type: 'FILE_PICKED'; path: string; name: string }
  | { type: 'REMOVE_ATTACHED_FILE'; path: string }
  | { type: 'SET_CORE_BUILDING'; active: boolean }
  | { type: 'BUILD_PAUSED' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INITIALIZED': {
      const s = action.state
      return {
        ...state,
        initialized: true,
        provider: s.provider,
        model: s.model,
        hasApiKey: s.hasApiKey,
        tier: s.tier,
        ledger: s.ledger,
        vaultEntries: s.vaultEntries,
        providers: s.providers,
      }
    }

    case 'STREAM_CHUNK':
      return { ...state, streaming: true, streamingText: state.streamingText + action.text }

    case 'THINKING_CHUNK':
      return { ...state, streaming: true, streamingThinking: state.streamingThinking + action.text }

    case 'STREAM_END': {
      if (!state.streamingText && !state.streaming) return state
      const assistantMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: state.streamingText,
        thinking: action.thinking || undefined,
        timestamp: Date.now(),
      }
      return {
        ...state,
        streaming: false,
        streamingText: '',
        streamingThinking: '',
        messages: state.streamingText
          ? [...state.messages, assistantMsg]
          : state.messages,
      }
    }

    case 'STREAM_ERROR':
      return { ...state, streaming: false, streamingText: '', streamingThinking: '', error: action.error }

    case 'LEDGER_UPDATE':
      return { ...state, ledger: action.ledger }

    case 'VAULT_ENTRIES':
      return { ...state, vaultEntries: action.entries }

    case 'LICENSE_STATUS':
      return { ...state, tier: action.tier }

    case 'DIFF_READY':
      return { ...state, pendingDiff: { count: action.count, files: action.files } }

    case 'DIFF_APPLIED':
      return { ...state, pendingDiff: null }

    case 'API_KEY_SET':
      return { ...state, hasApiKey: action.hasKey }

    case 'MODELS_LOADED':
      return { ...state, models: action.models }

    case 'SET_PERSONA':
      return { ...state, persona: action.persona }

    case 'SET_THINKING':
      return { ...state, thinkingBudget: action.budget }

    case 'SET_WORKSPACE':
      return { ...state, includeWorkspace: action.include }

    case 'SET_PROVIDER':
      return { ...state, provider: action.provider }

    case 'SET_MODEL':
      return { ...state, model: action.model }

    case 'SET_TAB':
      return { ...state, activeTab: action.tab }

    case 'SET_INPUT':
      return { ...state, input: action.input }

    case 'SEND_MESSAGE': {
      if (!state.input.trim()) return state
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: state.input.trim(),
        timestamp: Date.now(),
      }
      return { ...state, messages: [...state.messages, userMsg], input: '', attachedFiles: [] }
    }

    case 'CLEAR_ERROR':
      return { ...state, error: null }

    case 'CLEAR_HISTORY':
      return { ...state, messages: [], ledger: emptyLedger, pendingDiff: null, isCoreBuilding: false, buildPaused: false }

    case 'CREDIT_BALANCE':
      return { ...state, creditBalance: action.balance }

    case 'NEW_CHAT': {
      if (state.messages.length === 0) return { ...state, activeTab: 'chat' }
      const firstUser = state.messages.find(m => m.role === 'user')
      const title = firstUser ? firstUser.content.slice(0, 60) : 'Chat'
      const session: SavedSession = { id: Date.now().toString(), title, messages: state.messages, savedAt: Date.now() }
      const sessions = [session, ...state.savedSessions].slice(0, 50)
      try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)) } catch { /* ignore */ }
      return { ...state, messages: [], streamingText: '', pendingDiff: null, ledger: emptyLedger, input: '', savedSessions: sessions, activeTab: 'chat' }
    }

    case 'RESTORE_SESSION': {
      let sessions = state.savedSessions.filter(s => s.id !== action.session.id)
      if (state.messages.length > 0) {
        const firstUser = state.messages.find(m => m.role === 'user')
        const title = firstUser ? firstUser.content.slice(0, 60) : 'Chat'
        const current: SavedSession = { id: Date.now().toString(), title, messages: state.messages, savedAt: Date.now() }
        sessions = [current, ...sessions].slice(0, 50)
      }
      try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)) } catch { /* ignore */ }
      return { ...state, messages: action.session.messages, savedSessions: sessions, activeTab: 'chat', pendingDiff: null, input: '' }
    }

    case 'DELETE_SESSION': {
      const sessions = state.savedSessions.filter(s => s.id !== action.id)
      try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)) } catch { /* ignore */ }
      return { ...state, savedSessions: sessions }
    }

    case 'LOAD_SESSIONS':
      return { ...state, savedSessions: action.sessions }

    case 'WORKSPACE_TOKENS':
      return { ...state, workspaceTokens: action.tokens }

    case 'ACTIVE_FILE_CHANGED':
      return { ...state, activeFileName: action.name }

    case 'FILE_PICKED': {
      if (state.attachedFiles.some(f => f.path === action.path)) return state
      return { ...state, attachedFiles: [...state.attachedFiles, { path: action.path, name: action.name }] }
    }

    case 'REMOVE_ATTACHED_FILE':
      return { ...state, attachedFiles: state.attachedFiles.filter(f => f.path !== action.path) }

    case 'SET_CORE_BUILDING':
      return { ...state, isCoreBuilding: action.active, buildPaused: false }

    case 'BUILD_PAUSED':
      return { ...state, isCoreBuilding: false, buildPaused: true }

    default:
      return state
  }
}

// ─── App component ────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [inputHeight, setInputHeight] = useState(60)
  const [slashIndex, setSlashIndex] = useState(0)
  const resizeDragRef = useRef<{ startY: number; startH: number } | null>(null)

  const filteredSlashCommands = useMemo(() => {
    if (!state.input.startsWith('/')) return []
    const query = state.input.split(' ')[0].toLowerCase()
    return SLASH_COMMANDS.filter(c => c.id.startsWith(query))
  }, [state.input])

  const slashMenuOpen = filteredSlashCommands.length > 0 && !state.streaming

  const handleResizeDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeDragRef.current = { startY: e.clientY, startH: inputHeight }
    const onMove = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return
      const delta = resizeDragRef.current.startY - ev.clientY // drag UP = positive = taller
      const newH = Math.max(60, Math.min(300, resizeDragRef.current.startH + delta))
      setInputHeight(newH)
    }
    const onUp = () => {
      resizeDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [inputHeight])

  // Load saved sessions from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY)
      if (raw) {
        const sessions = JSON.parse(raw) as SavedSession[]
        dispatch({ type: 'LOAD_SESSIONS', sessions })
      }
    } catch { /* ignore */ }
  }, [])

  // Receive messages from extension host
  useEffect(() => {
    let initialized = false
    // Local tracking of streaming text for the continuation check.
    // Using a closure variable avoids stale-ref issues since the handler
    // is defined once and never re-registered.
    let streamingText = ''

    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage
      switch (msg.type) {
        case 'initialized':
          initialized = true
          dispatch({ type: 'INITIALIZED', state: msg.state })
          break
        case 'streamChunk':
          streamingText += msg.text
          dispatch({ type: 'STREAM_CHUNK', text: msg.text })
          break
        case 'thinkingChunk':
          dispatch({ type: 'THINKING_CHUNK', text: msg.text })
          break
        case 'streamEnd': {
          const textForCheck = streamingText
          streamingText = ''
          dispatch({ type: 'STREAM_END', thinking: msg.thinking })
          // CORE autonomous continuation — check if the response signals more output.
          // The extension host tracks the 12-continuation cap and sends buildPaused if hit.
          if (/\[CONTINUING/i.test(textForCheck)) {
            dispatch({ type: 'SET_CORE_BUILDING', active: true })
            postMessage({ type: 'continue' })
          } else {
            dispatch({ type: 'SET_CORE_BUILDING', active: false })
          }
          break
        }
        case 'buildPaused':
          dispatch({ type: 'BUILD_PAUSED' })
          break
        case 'streamError':
          dispatch({ type: 'STREAM_ERROR', error: msg.error })
          break
        case 'ledgerUpdate':
          dispatch({ type: 'LEDGER_UPDATE', ledger: msg.ledger })
          break
        case 'vaultEntries':
          dispatch({ type: 'VAULT_ENTRIES', entries: msg.entries })
          break
        case 'licenseStatus':
          dispatch({ type: 'LICENSE_STATUS', tier: msg.tier })
          break
        case 'diffReady':
          dispatch({ type: 'DIFF_READY', count: msg.count, files: msg.files })
          break
        case 'diffApplied':
          dispatch({ type: 'DIFF_APPLIED', applied: msg.applied, failed: msg.failed })
          break
        case 'apiKeySet':
          dispatch({ type: 'API_KEY_SET', hasKey: msg.hasKey })
          break
        case 'modelsLoaded':
          dispatch({ type: 'MODELS_LOADED', models: msg.models })
          break
        case 'creditBalance':
          dispatch({ type: 'CREDIT_BALANCE', balance: msg.balance })
          break
        case 'workspaceTokens':
          dispatch({ type: 'WORKSPACE_TOKENS', tokens: msg.tokens })
          break
        case 'filePicked':
          dispatch({ type: 'FILE_PICKED', path: msg.path, name: msg.name })
          break
        case 'activeFileChanged':
          dispatch({ type: 'ACTIVE_FILE_CHANGED', name: msg.name })
          break
        case 'error':
          dispatch({ type: 'STREAM_ERROR', error: msg.message })
          break
      }
    }
    window.addEventListener('message', handler)
    postMessage({ type: 'ready' })

    // Retry every 2s if the extension host hasn't responded yet.
    // Guards against the case where 'ready' was sent before the extension
    // host's message handler was registered (e.g. slow activation).
    const retryInterval = setInterval(() => {
      if (!initialized) postMessage({ type: 'ready' })
    }, 2000)

    return () => {
      window.removeEventListener('message', handler)
      clearInterval(retryInterval)
    }
  }, [])

  const sendMessage = useCallback(() => {
    const rawText = state.input.trim()
    if (!rawText || state.streaming) return

    // Expand slash commands — chat display shows /fix, AI receives the full instruction
    let messageToSend = rawText
    let includeActiveFile = false
    const slashMatch = /^(\/\w+)([ \t][\s\S]*)?$/.exec(rawText)
    if (slashMatch) {
      const cmd = slashMatch[1]
      const extra = slashMatch[2]?.trim() ?? ''
      const prompt = SLASH_PROMPTS[cmd]
      if (prompt) {
        messageToSend = extra ? `${prompt}\n\n${extra}` : prompt
        includeActiveFile = true
      }
    }

    dispatch({ type: 'SEND_MESSAGE' })
    postMessage({
      type: 'chat',
      message: messageToSend,
      persona: state.persona,
      thinkingBudget: state.thinkingBudget,
      includeWorkspace: state.includeWorkspace,
      includeActiveFile,
      attachedFiles: state.attachedFiles.map(f => f.path),
    })
  }, [state.input, state.streaming, state.persona, state.thinkingBudget, state.includeWorkspace, state.attachedFiles])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashMenuOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashIndex(i => (i + 1) % filteredSlashCommands.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashIndex(i => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length)
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          const selected = filteredSlashCommands[slashIndex]
          if (selected) {
            dispatch({ type: 'SET_INPUT', input: selected.id + ' ' })
            setSlashIndex(0)
          }
          return
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage, slashMenuOpen, filteredSlashCommands, slashIndex],
  )

  const handleProviderChange = (provider: Provider) => {
    dispatch({ type: 'SET_PROVIDER', provider })
    postMessage({ type: 'setProvider', provider })
  }

  const handleModelChange = (model: string) => {
    dispatch({ type: 'SET_MODEL', model })
    postMessage({ type: 'setModel', model })
  }

  const handleApiKeySubmit = (key: string) => {
    postMessage({ type: 'setApiKey', key })
  }

  const handleCancelStream = () => {
    postMessage({ type: 'cancelStream' })
    dispatch({ type: 'STREAM_END' })
  }

  // VS Code webviews block navigator.clipboard — use execCommand via a hidden textarea
  const copyToClipboard = useCallback((text: string) => {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(el)
      el.focus()
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    } catch { /* ignore */ }
  }, [])

  const copyLastExchange = useCallback(() => {
    const msgs = state.messages
    if (msgs.length === 0) return
    let start = msgs.length - 1
    while (start > 0 && msgs[start].role !== 'user') start--
    const text = msgs.slice(start).map(m => {
      const label = m.role === 'user' ? 'You' : 'Code Pirate'
      const thinking = m.thinking ? `[Thinking]\n${m.thinking}\n[/Thinking]\n\n` : ''
      return `${label}: ${thinking}${m.content}`
    }).join('\n\n')
    copyToClipboard(text)
  }, [state.messages, copyToClipboard])

  const copyAll = useCallback(() => {
    if (state.messages.length === 0) return
    const text = state.messages.map(m => {
      const label = m.role === 'user' ? 'You' : 'Code Pirate'
      const thinking = m.thinking ? `[Thinking]\n${m.thinking}\n[/Thinking]\n\n` : ''
      return `${label}: ${thinking}${m.content}`
    }).join('\n\n')
    copyToClipboard(text)
  }, [state.messages, copyToClipboard])

  // When @workspace is toggled on, request an accurate token count from the
  // extension host.  When toggled off, reset so we stop adding workspace cost.
  useEffect(() => {
    if (state.includeWorkspace) {
      dispatch({ type: 'WORKSPACE_TOKENS', tokens: null }) // show spinner / pending
      postMessage({ type: 'estimateWorkspaceTokens' })
    } else {
      dispatch({ type: 'WORKSPACE_TOKENS', tokens: 0 })
    }
  }, [state.includeWorkspace])

  const estimatedCost = useMemo(() => {
    if (!state.input.trim()) return null

    // Look up prompt pricing — OR models list first, then static fallback for
    // non-OpenRouter providers (Anthropic Direct, Groq, Mistral, etc.)
    let promptCostPer1k = state.models.find(m => m.id === state.model)?.promptCostPer1k
    if (!promptCostPer1k) {
      for (const list of Object.values(STATIC_MODELS)) {
        const found = list?.find(m => m.id === state.model)
        if (found && found.promptCostPer1k > 0) {
          promptCostPer1k = found.promptCostPer1k
          break
        }
      }
    }
    if (!promptCostPer1k) return null

    // The system prompt (persona + rules) adds ~700 tokens to every request.
    // Without this the estimate for short first messages is near zero and
    // falls below the display threshold, making it appear broken.
    const SYSTEM_PROMPT_OVERHEAD = 700
    const historyChars = state.messages.reduce((sum, m) => sum + m.content.length, 0)
    const wsTokens = state.includeWorkspace ? (state.workspaceTokens ?? 0) : 0
    const estimatedTokens = Math.ceil((historyChars + state.input.length) / 4) + wsTokens + SYSTEM_PROMPT_OVERHEAD
    const cost = (estimatedTokens / 1000) * promptCostPer1k
    if (cost < 0.0001) return `<$0.0001 est.`
    return `~$${cost.toFixed(4)} est.`
  }, [state.input, state.model, state.models, state.messages, state.includeWorkspace, state.workspaceTokens])

  if (!state.initialized) {
    return (
      <div className="app" style={{ alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
        Loading…
      </div>
    )
  }

  return (
    <div className="app">
      {/* Header: title + provider + model */}
      <div className="header">
        <div className="header-title">
          <span className="header-name">Code Pirate</span>
          <span
            className={`license-badge ${state.tier}`}
            title={state.tier === 'pro' ? 'Pro' : 'Free — upgrade at codepirate.cc/pro'}
          >
            {state.tier === 'pro' ? '⚡ Pro' : 'Free tier'}
          </span>
        </div>
        <ProviderSelector
          providers={state.providers}
          models={state.models}
          provider={state.provider}
          model={state.model}
          onProviderChange={handleProviderChange}
          onModelChange={handleModelChange}
        />
      </div>

      {/* Tab bar */}
      <div className="tabs">
        {(['chat', 'vault', 'settings', 'history'] as const).map((tab) => (
          <button
            key={tab}
            className={`tab ${state.activeTab === tab ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_TAB', tab })}
          >
            {tab === 'chat' ? 'Chat' : tab === 'vault' ? 'Vault' : tab === 'settings' ? 'Settings' : '🕐'}
          </button>
        ))}
        <button
          className="tab tab-new"
          onClick={() => dispatch({ type: 'NEW_CHAT' })}
          title="New chat (saves current)"
        >+</button>
      </div>

      {/* Error bar */}
      {state.error && (
        <div className="error-bar">
          <span>{state.error}</span>
          <button className="btn-icon" onClick={() => dispatch({ type: 'CLEAR_ERROR' })}>✕</button>
        </div>
      )}

      {/* Main content */}
      <div className="content">
        {state.activeTab === 'chat' && (
          <>
            <MessageList
              messages={state.messages}
              streamingText={state.streamingText}
              streamingThinking={state.streamingThinking}
              streaming={state.streaming}
            />

            {/* Copy toolbar — visible when there are messages */}
            {state.messages.length > 0 && (
              <div className="chat-toolbar">
                <button className="btn-icon" onClick={copyLastExchange} title="Copy last exchange">⎘ Last</button>
                <button className="btn-icon" onClick={copyAll} title="Copy all messages">⎘ All</button>
              </div>
            )}

            {/* Diff banner */}
            {state.pendingDiff && (
              <div className="diff-banner">
                <div className="diff-banner-title">
                  📁 {state.pendingDiff.count} file{state.pendingDiff.count !== 1 ? 's' : ''} ready to apply
                </div>
                <div className="diff-files">{state.pendingDiff.files.join(', ')}</div>
                <div className="diff-actions">
                  <button className="btn-secondary" onClick={() => postMessage({ type: 'previewDiff' })}>
                    Preview diff
                  </button>
                  <button className="btn-primary" onClick={() => postMessage({ type: 'applyDiff' })}>
                    Apply all
                  </button>
                  <button className="btn-icon" onClick={() => { postMessage({ type: 'rejectDiff' }); dispatch({ type: 'DIFF_APPLIED', applied: [], failed: [] }) }}>
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Input area */}
            <div className="input-area">
              {/* Drag handle — pull UP to make textarea taller */}
              <div
                className="input-resize-handle"
                onMouseDown={handleResizeDragStart}
                title="Drag up to expand"
              />
              {controlsOpen && (
                <div className="input-controls">
                  <PersonaSwitcher
                    persona={state.persona}
                    onChange={(p) => dispatch({ type: 'SET_PERSONA', persona: p })}
                  />
                  <ThinkingDial
                    budget={state.thinkingBudget}
                    onChange={(b) => dispatch({ type: 'SET_THINKING', budget: b })}
                  />
                  <label className="workspace-toggle">
                    <input
                      type="checkbox"
                      checked={state.includeWorkspace}
                      onChange={(e) => dispatch({ type: 'SET_WORKSPACE', include: e.target.checked })}
                    />
                    @workspace
                  </label>
                </div>
              )}

              {slashMenuOpen && (
                <div className="slash-menu">
                  {filteredSlashCommands.map((cmd, i) => (
                    <button
                      key={cmd.id}
                      className={`slash-item${i === slashIndex ? ' selected' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        dispatch({ type: 'SET_INPUT', input: cmd.id + ' ' })
                        setSlashIndex(0)
                        textareaRef.current?.focus()
                      }}
                    >
                      <span className="slash-cmd">{cmd.id}</span>
                      <span className="slash-desc">{cmd.desc}</span>
                    </button>
                  ))}
                </div>
              )}

              {state.attachedFiles.length > 0 && (
                <div className="attached-files">
                  {state.attachedFiles.map(f => (
                    <span key={f.path} className="file-chip">
                      📄 {f.name}
                      <button
                        className="file-chip-remove"
                        onClick={() => dispatch({ type: 'REMOVE_ATTACHED_FILE', path: f.path })}
                        title="Remove"
                      >✕</button>
                    </span>
                  ))}
                </div>
              )}

              <div className="input-row">
                <button
                  className={`controls-toggle${controlsOpen ? ' active' : ''}`}
                  onClick={() => setControlsOpen(o => !o)}
                  title="Toggle persona, thinking & workspace controls"
                >⚙️</button>
                <button
                  className="controls-toggle"
                  onClick={() => postMessage({ type: 'requestActiveFile' })}
                  onContextMenu={(e) => { e.preventDefault(); postMessage({ type: 'requestFilePicker' }) }}
                  title="Attach active file (right-click to browse all files)"
                >📎</button>
                <textarea
                  ref={textareaRef}
                  value={state.input}
                  onChange={(e) => dispatch({ type: 'SET_INPUT', input: e.target.value })}
                  onKeyDown={handleKeyDown}
                  placeholder={state.hasApiKey ? 'Message… (Enter to send, Shift+Enter for newline)' : 'Enter your API key in Settings first…'}
                  disabled={state.streaming}
                  style={{ height: inputHeight, minHeight: inputHeight, maxHeight: inputHeight, resize: 'none' }}
                />
                {state.streaming ? (
                  <button className="btn-secondary" onClick={handleCancelStream} title="Cancel">
                    ■
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={sendMessage}
                    disabled={!state.input.trim() || !state.hasApiKey}
                    title="Send (Enter)"
                  >
                    ↑
                  </button>
                )}
              </div>
              {state.isCoreBuilding && !state.buildPaused && (
                <div className="core-building-banner">Building... auto-continuing</div>
              )}
              {state.buildPaused && (
                <div className="core-building-banner core-paused">
                  Build paused
                  <button
                    className="btn-secondary"
                    style={{ marginLeft: 8, padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => {
                      dispatch({ type: 'SET_CORE_BUILDING', active: true })
                      postMessage({ type: 'resumeBuild' })
                    }}
                  >
                    Resume
                  </button>
                </div>
              )}
              {estimatedCost && (
                <div className="cost-estimate">{estimatedCost}</div>
              )}
              {state.activeFileName && (
                <div className="active-file-indicator" title="Active editor — /fix, /explain, /tests, /doc will include this file">
                  📄 {state.activeFileName}
                </div>
              )}
            </div>
          </>
        )}

        {state.activeTab === 'vault' && (
          <VaultPanel
            entries={state.vaultEntries}
            onSave={(name, content) => postMessage({ type: 'saveVaultEntry', name, content })}
            onDelete={(id) => postMessage({ type: 'deleteVaultEntry', id })}
            onInsert={(content) => {
              dispatch({ type: 'SET_INPUT', input: content })
              dispatch({ type: 'SET_TAB', tab: 'chat' })
            }}
          />
        )}

        {state.activeTab === 'settings' && (
          <SettingsView
            hasApiKey={state.hasApiKey}
            tier={state.tier}
            onApiKeySubmit={handleApiKeySubmit}
            inputRef={inputRef}
          />
        )}

        {state.activeTab === 'history' && (
          <div className="history-view">
            {state.savedSessions.length === 0 ? (
              <div style={{ opacity: 0.5, padding: '8px', fontSize: 12 }}>
                No saved chats yet. Click <strong>+</strong> to start a new chat and save the current one.
              </div>
            ) : (
              state.savedSessions.map(session => (
                <div key={session.id} className="history-session">
                  <button
                    className="history-session-restore"
                    onClick={() => dispatch({ type: 'RESTORE_SESSION', session })}
                    title="Restore this chat"
                  >
                    <div className="history-session-title">{session.title}</div>
                    <div className="history-session-meta">
                      {new Date(session.savedAt).toLocaleDateString()} · {session.messages.length} message{session.messages.length !== 1 ? 's' : ''}
                    </div>
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => dispatch({ type: 'DELETE_SESSION', id: session.id })}
                    title="Delete"
                  >✕</button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Ledger footer — always shown */}
      <Ledger ledger={state.ledger} provider={state.provider} creditBalance={state.creditBalance} estimatedCost={estimatedCost} />
    </div>
  )
}

// ─── Settings view (inline to keep file count manageable) ────────────────────

interface SettingsViewProps {
  hasApiKey: boolean
  tier: 'free' | 'pro'
  onApiKeySubmit: (key: string) => void
  inputRef: React.RefObject<HTMLInputElement>
}

function SettingsView({ hasApiKey, tier, onApiKeySubmit, inputRef }: SettingsViewProps) {
  const [apiKeyInput, setApiKeyInput] = React.useState('')
  const [licenseInput, setLicenseInput] = React.useState('')

  return (
    <div className="settings-view">
      <div className="settings-group">
        <div className="settings-label">API Key</div>
        <input
          ref={inputRef}
          type="password"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder={hasApiKey ? '••••••••••••••• (key saved)' : 'Paste your API key…'}
        />
        <button
          className="btn-primary"
          onClick={() => { if (apiKeyInput) onApiKeySubmit(apiKeyInput); setApiKeyInput('') }}
          disabled={!apiKeyInput}
        >
          {hasApiKey ? 'Update Key' : 'Save Key'}
        </button>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          Stored in VS Code SecretStorage — never written to disk or settings.json.
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">
          License{' '}
          <span className={`license-badge ${tier}`}>{tier === 'pro' ? '⚡ Pro' : 'Free'}</span>
        </div>
        {tier === 'free' && (
          <>
            <input
              type="text"
              value={licenseInput}
              onChange={(e) => setLicenseInput(e.target.value)}
              placeholder="CP-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            />
            <button
              className="btn-primary"
              onClick={() => { postMessage({ type: 'activateLicense', key: licenseInput }); setLicenseInput('') }}
              disabled={!licenseInput}
            >
              Activate Pro
            </button>
            <div style={{ fontSize: 11, opacity: 0.6 }}>
              Upgrade at <span style={{ color: 'var(--vscode-textLink-foreground)' }}>codepirate.cc/pro</span> — $9.99/month.
            </div>
          </>
        )}
        {tier === 'pro' && (
          <div style={{ fontSize: 12, color: 'var(--vscode-gitDecoration-addedResourceForeground)' }}>
            Pro license active ✓
          </div>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-label">Provider & Model</div>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          Configure the provider and model in the Chat tab header.
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Getting Started</div>
        <div style={{ fontSize: 11, lineHeight: 1.6, opacity: 0.8 }}>
          1. Get an API key from OpenRouter (openrouter.ai) or Anthropic (console.anthropic.com)<br />
          2. Paste it above and click Save Key<br />
          3. Select your provider and model in the Chat tab<br />
          4. Start chatting — your key, your models, no throttling
        </div>
      </div>
    </div>
  )
}
