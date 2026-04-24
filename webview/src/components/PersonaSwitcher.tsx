import type { Persona } from '../types'

const PERSONAS: Array<{ id: Persona; label: string; title: string }> = [
  { id: 'architect', label: 'Arch', title: 'Lead Architect — full files, systems thinking' },
  { id: 'diff', label: 'Diff', title: 'Diff Agent — precise file modifications only' },
  { id: 'snippet', label: 'Snip', title: 'Snippet Engine — fast, minimal code snippets' },
]

interface Props {
  persona: Persona
  onChange: (persona: Persona) => void
}

export function PersonaSwitcher({ persona, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {PERSONAS.map((p) => (
        <button
          key={p.id}
          className={`persona-btn ${persona === p.id ? 'active' : ''}`}
          onClick={() => onChange(p.id)}
          title={p.title}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
