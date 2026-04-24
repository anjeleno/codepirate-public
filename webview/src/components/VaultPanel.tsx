import { useState } from 'react'
import type { VaultEntry } from '../types'

interface Props {
  entries: VaultEntry[]
  onSave: (name: string, content: string) => void
  onDelete: (id: string) => void
  onInsert: (content: string) => void
}

export function VaultPanel({ entries, onSave, onDelete, onInsert }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const handleSave = () => {
    if (!name.trim() || !content.trim()) return
    onSave(name, content)
    setName('')
    setContent('')
    setShowForm(false)
  }

  return (
    <div className="vault-view">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="section-title">Blueprint Vault</div>
        <button className="btn-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New'}
        </button>
      </div>

      {showForm && (
        <div className="vault-form">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name…"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Prompt template content…"
            rows={4}
          />
          <button className="btn-primary" onClick={handleSave} disabled={!name.trim() || !content.trim()}>
            Save to Vault
          </button>
        </div>
      )}

      {entries.length === 0 && !showForm && (
        <div style={{ opacity: 0.5, fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
          No saved templates yet.<br />
          Save your best prompts here for quick reuse.
        </div>
      )}

      {entries.map((entry) => (
        <div key={entry.id} className="vault-entry">
          <div className="vault-entry-header">
            <div className="vault-entry-name">{entry.name}</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn-secondary"
                style={{ fontSize: 11, padding: '2px 6px' }}
                onClick={() => onInsert(entry.content)}
                title="Insert into chat input"
              >
                Use
              </button>
              <button
                className="btn-icon"
                onClick={() => onDelete(entry.id)}
                title="Delete"
                style={{ fontSize: 11 }}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="vault-entry-preview">{entry.content}</div>
        </div>
      ))}
    </div>
  )
}
