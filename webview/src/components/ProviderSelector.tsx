import { useState, useRef, useEffect } from 'react'
import type { Provider, ProviderInfo, ModelInfo } from '../types'

type SortKey = 'default' | 'cost-asc' | 'cost-desc' | 'ctx-desc' | 'name'
const SORT_LABELS: Record<SortKey, string> = {
  default:    'Default',
  'cost-asc':  '$↑',
  'cost-desc': '$↓',
  'ctx-desc':  'Ctx',
  name:        'A–Z',
}

// Default model per provider — used by the ↺ reset button
const DEFAULT_MODEL: Partial<Record<Provider, string>> = {
  openrouter:        'deepseek/deepseek-v4-pro',
  'anthropic-direct':'claude-sonnet-4-5',
  groq:              'llama-3.3-70b-versatile',
  mistral:           'mistral-large-latest',
  gemini:            'gemini-2.5-flash',
  together:          'meta-llama/Llama-3-70b-chat-hf',
}

// Static model lists for non-OpenRouter providers
export const STATIC_MODELS: Partial<Record<Provider, ModelInfo[]>> = {
  // Fallback pricing for common OpenRouter models.
  // OR serves versioned slugs (e.g. deepseek/deepseek-v4-pro-20260423) in its
  // models list, so the live lookup by unversioned ID fails. These entries
  // ensure the pre-send cost estimate always has data for the default model.
  openrouter: [
    { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4-Pro', contextLength: 163840, promptCostPer1k: 0.00108, completionCostPer1k: 0.00555, provider: 'deepseek' },
    { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', contextLength: 200000, promptCostPer1k: 0.015, completionCostPer1k: 0.075, provider: 'anthropic' },
    { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextLength: 200000, promptCostPer1k: 0.003, completionCostPer1k: 0.015, provider: 'anthropic' },
  ],
  'anthropic-direct': [
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextLength: 200000, promptCostPer1k: 0.015, completionCostPer1k: 0.075, provider: 'anthropic' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextLength: 200000, promptCostPer1k: 0.003, completionCostPer1k: 0.015, provider: 'anthropic' },
    { id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', contextLength: 200000, promptCostPer1k: 0.0008, completionCostPer1k: 0.004, provider: 'anthropic' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextLength: 128000, promptCostPer1k: 0.00059, completionCostPer1k: 0.00079, provider: 'groq' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', contextLength: 128000, promptCostPer1k: 0.00005, completionCostPer1k: 0.00008, provider: 'groq' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', contextLength: 32768, promptCostPer1k: 0.00024, completionCostPer1k: 0.00024, provider: 'groq' },
  ],
  mistral: [
    { id: 'mistral-large-latest', name: 'Mistral Large', contextLength: 128000, promptCostPer1k: 0.002, completionCostPer1k: 0.006, provider: 'mistral' },
    { id: 'mistral-small-latest', name: 'Mistral Small', contextLength: 128000, promptCostPer1k: 0.0002, completionCostPer1k: 0.0006, provider: 'mistral' },
    { id: 'codestral-latest', name: 'Codestral', contextLength: 256000, promptCostPer1k: 0.0003, completionCostPer1k: 0.0009, provider: 'mistral' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000, promptCostPer1k: 0.00125, completionCostPer1k: 0.01, provider: 'google' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: 1000000, promptCostPer1k: 0.00015, completionCostPer1k: 0.0006, provider: 'google' },
  ],
  together: [
    { id: 'meta-llama/Llama-3-70b-chat-hf', name: 'Llama 3 70B', contextLength: 8192, promptCostPer1k: 0.0009, completionCostPer1k: 0.0009, provider: 'meta' },
    { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', name: 'Mixtral 8x22B', contextLength: 65536, promptCostPer1k: 0.0012, completionCostPer1k: 0.0012, provider: 'mistral' },
  ],
}

interface Props {
  providers: ProviderInfo[]
  models: ModelInfo[]
  provider: Provider
  model: string
  onProviderChange: (provider: Provider) => void
  onModelChange: (model: string) => void
}

export function ProviderSelector({
  providers,
  models,
  provider,
  model,
  onProviderChange,
  onModelChange,
}: Props) {
  const [query, setQuery] = useState(model)
  const [open, setOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('default')
  const containerRef = useRef<HTMLDivElement>(null)
  // Track whether a dropdown item was just selected so handleBlur
  // doesn't overwrite the correct ID with a stale search term.
  const justSelectedRef = useRef(false)

  // Sync external model changes into local query (e.g. after provider switch)
  useEffect(() => { setQuery(model) }, [model])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Determine the available model list for this provider
  const isLocal = provider === 'ollama' || provider === 'lmstudio' || provider === 'freellmapi'
  const isCustom = provider === 'custom'
  const isOpenRouter = provider === 'openrouter'
  const availableModels: ModelInfo[] = isOpenRouter
    ? models
    : (STATIC_MODELS[provider] ?? [])

  // Filter, sort, then cap at 50.
  // In Default sort, always float the currently-selected model to position 0
  // so it remains visible regardless of where OpenRouter places it in its list.
  const q = query.toLowerCase()
  const matched = availableModels.filter(
    m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
  )
  const sorted = [...matched].sort((a, b) => {
    switch (sortBy) {
      case 'cost-asc':  return a.promptCostPer1k - b.promptCostPer1k
      case 'cost-desc': return b.promptCostPer1k - a.promptCostPer1k
      case 'ctx-desc':  return b.contextLength - a.contextLength
      case 'name':      return a.name.localeCompare(b.name)
      default: {
        // Float the active model to top so the default is always discoverable
        if (a.id === model) return -1
        if (b.id === model) return 1
        return 0
      }
    }
  })
  const filtered = sorted.slice(0, 50)

  const handleSelect = (id: string) => {
    justSelectedRef.current = true
    setQuery(id)
    onModelChange(id)
    setOpen(false)
  }

  const handleBlur = () => {
    if (justSelectedRef.current) {
      // A dropdown item was clicked — handleSelect already called onModelChange
      // with the correct ID. Don't overwrite it with the stale query value.
      justSelectedRef.current = false
      setTimeout(() => setOpen(false), 150)
      return
    }
    // Commit whatever is typed as the model id
    onModelChange(query)
    setTimeout(() => setOpen(false), 150) // delay so click on item fires first
  }

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Provider select */}
      <select
        value={provider}
        onChange={e => {
          onProviderChange(e.target.value as Provider)
          setQuery('') // clear model on provider change
          setSortBy('default')
        }}
        style={{ flex: '1', minWidth: 100, fontSize: 11 }}
        title="Provider"
      >
        {providers.map(p => (
          <option key={p.id} value={p.id}>
            {p.isLocal ? `⬡ ${p.label}` : p.label}
          </option>
        ))}
      </select>

      {/* Model field — autocomplete for known providers, free-text for local/custom */}
      {(isLocal || isCustom || availableModels.length === 0) ? (
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); onModelChange(e.target.value) }}
          placeholder={isLocal ? 'e.g. llama3' : 'model id…'}
          style={{ flex: '2', minWidth: 120, fontSize: 11 }}
          title="Model ID"
        />
      ) : (
        <div ref={containerRef} style={{ flex: '2', minWidth: 120, position: 'relative' }}>
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={handleBlur}
            placeholder="Search models…"
            style={{ width: '100%', fontSize: 11, boxSizing: 'border-box', paddingRight: 36 }}
            title="Model — type to filter"
            spellCheck={false}
            autoComplete="off"
          />
          {/* ✕ clear  ↺ default — inline micro-buttons inside the input */}
          <div style={{
            position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
            display: 'flex', gap: 1,
          }}>
            <span
              onMouseDown={e => { e.preventDefault(); setQuery(''); onModelChange(''); setOpen(true) }}
              title="Clear model"
              style={{ fontSize: 9, opacity: 0.45, cursor: 'pointer', padding: '1px 3px', userSelect: 'none' }}
            >✕</span>
            {DEFAULT_MODEL[provider] && (
              <span
                onMouseDown={e => {
                  e.preventDefault()
                  const def = DEFAULT_MODEL[provider]!
                  setQuery(def)
                  onModelChange(def)
                  setOpen(false)
                }}
                title={`Reset to default (${DEFAULT_MODEL[provider]})`}
                style={{ fontSize: 9, opacity: 0.45, cursor: 'pointer', padding: '1px 3px', userSelect: 'none' }}
              >↺</span>
            )}
          </div>
          {open && filtered.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 100,
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border)',
              borderTop: 'none',
              maxHeight: 220,
              overflowY: 'auto',
              fontSize: 11,
            }}>
              {availableModels.length > 10 && (
                <div style={{
                  display: 'flex',
                  gap: 3,
                  padding: '3px 6px',
                  borderBottom: '1px solid var(--vscode-widget-border, #333)',
                  alignItems: 'center',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--vscode-dropdown-background)',
                  zIndex: 1,
                }}>
                  <span style={{ fontSize: 9, opacity: 0.45, marginRight: 1 }}>Sort:</span>
                  {(['default', 'cost-asc', 'cost-desc', 'ctx-desc', 'name'] as SortKey[]).map(key => (
                    <span
                      key={key}
                      onMouseDown={e => { e.preventDefault(); setSortBy(key) }}
                      style={{
                        fontSize: 9,
                        cursor: 'pointer',
                        padding: '1px 5px',
                        borderRadius: 2,
                        userSelect: 'none',
                        background: sortBy === key ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                        color: sortBy === key ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)',
                        opacity: sortBy === key ? 1 : 0.55,
                      }}
                    >
                      {SORT_LABELS[key]}
                    </span>
                  ))}
                </div>
              )}
              {filtered.map(m => (
                <div
                  key={m.id}
                  onMouseDown={() => handleSelect(m.id)}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--vscode-widget-border, #333)',
                    background: m.id === model
                      ? 'var(--vscode-list-activeSelectionBackground)'
                      : 'transparent',
                    color: m.id === model
                      ? 'var(--vscode-list-activeSelectionForeground)'
                      : 'var(--vscode-foreground)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)')}
                  onMouseLeave={e => (e.currentTarget.style.background = m.id === model ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent')}
                >
                  <div style={{ fontWeight: 500 }}>{m.name}</div>
                  <div style={{ opacity: 0.6, fontSize: 10 }}>
                    {m.id}
                    {m.promptCostPer1k > 0 && ` · $${m.promptCostPer1k.toFixed(4)}/1k in`}
                    {m.contextLength > 0 && ` · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {provider === 'freellmapi' && (
        <div style={{ width: '100%', marginTop: 2 }}>
          <a
            href="https://github.com/tashfeenahmed/freellmapi"
            style={{ fontSize: 10, opacity: 0.6, textDecoration: 'none' }}
            title="FreeLLMAPI — self-hosted proxy aggregating 11+ free-tier AI providers"
          >
            ↗ github.com/tashfeenahmed/freellmapi
          </a>
        </div>
      )}

    </div>
  )
}

