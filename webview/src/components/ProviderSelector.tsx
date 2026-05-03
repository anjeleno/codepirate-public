import { useState, useRef, useEffect } from 'react'
import type { Provider, ProviderInfo, ModelInfo } from '../types'

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
  const isLocal = provider === 'ollama' || provider === 'lmstudio'
  const isCustom = provider === 'custom'
  const isOpenRouter = provider === 'openrouter'
  const availableModels: ModelInfo[] = isOpenRouter
    ? models
    : (STATIC_MODELS[provider] ?? [])

  // Filter by query
  const q = query.toLowerCase()
  const filtered = availableModels.filter(
    m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
  ).slice(0, 50) // cap at 50 to keep dropdown snappy

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
            style={{ width: '100%', fontSize: 11, boxSizing: 'border-box' }}
            title="Model — type to filter"
            spellCheck={false}
            autoComplete="off"
          />
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

    </div>
  )
}

