import type { ThinkingBudget } from '../types'

const LEVELS: Array<{ id: ThinkingBudget; label: string; title: string }> = [
  { id: 'off', label: 'Off', title: 'No extended thinking — fastest responses' },
  { id: 'medium', label: '~4k', title: 'Medium thinking — 4,000 budget tokens' },
  { id: 'high', label: '~16k', title: 'High thinking — 16,000 budget tokens' },
  { id: 'max', label: 'Max', title: 'Max thinking — 32,000 budget tokens (Anthropic models only)' },
]

interface Props {
  budget: ThinkingBudget
  onChange: (budget: ThinkingBudget) => void
}

export function ThinkingDial({ budget, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      <span style={{ fontSize: 10, opacity: 0.6, marginRight: 1 }}>🧠</span>
      {LEVELS.map((l) => (
        <button
          key={l.id}
          className={`thinking-btn ${budget === l.id ? 'active' : ''}`}
          onClick={() => onChange(l.id)}
          title={l.title}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
