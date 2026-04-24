import * as vscode from 'vscode'
import type { VaultEntry } from './types'

const VAULT_STATE_KEY = 'codePirate.vault'

export class VaultManager {
  constructor(private readonly globalState: vscode.Memento) {}

  getEntries(): VaultEntry[] {
    return this.globalState.get<VaultEntry[]>(VAULT_STATE_KEY, [])
  }

  async saveEntry(name: string, content: string): Promise<VaultEntry> {
    const entries = this.getEntries()
    const entry: VaultEntry = {
      id: crypto.randomUUID(),
      name: name.trim(),
      content: content.trim(),
      createdAt: Date.now(),
    }
    entries.push(entry)
    await this.globalState.update(VAULT_STATE_KEY, entries)
    return entry
  }

  async deleteEntry(id: string): Promise<void> {
    const entries = this.getEntries().filter((e) => e.id !== id)
    await this.globalState.update(VAULT_STATE_KEY, entries)
  }

  async renameEntry(id: string, newName: string): Promise<void> {
    const entries = this.getEntries().map((e) =>
      e.id === id ? { ...e, name: newName.trim() } : e,
    )
    await this.globalState.update(VAULT_STATE_KEY, entries)
  }

  getFormattedForContext(): string {
    const entries = this.getEntries()
    if (entries.length === 0) return ''
    return (
      '[Blueprint Vault — saved prompt templates]\n' +
      entries.map((e) => `### ${e.name}\n${e.content}`).join('\n\n')
    )
  }
}
