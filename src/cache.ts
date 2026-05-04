import * as vscode from 'vscode'
import * as fs from 'fs/promises'

// ─── Undo snapshots for AI-applied file changes ───────────────────────────────
// Stores file content + mtime before any AI write.
// On revert, checks current mtime — if the file was manually edited since the
// AI write, shows a diff preview before overwriting.

export interface Snapshot {
  uri: string
  content: string
  mtimeMs: number
  takenAt: number
}

export class SnapshotCache {
  private snapshots = new Map<string, Snapshot>()

  async take(uri: vscode.Uri): Promise<void> {
    try {
      const fsPath = uri.fsPath
      const [content, stat] = await Promise.all([
        fs.readFile(fsPath, 'utf-8'),
        fs.stat(fsPath),
      ])
      this.snapshots.set(uri.toString(), {
        uri: uri.toString(),
        content,
        mtimeMs: stat.mtimeMs,
        takenAt: Date.now(),
      })
    } catch {
      // File doesn't exist yet — snapshot empty content
      this.snapshots.set(uri.toString(), {
        uri: uri.toString(),
        content: '',
        mtimeMs: 0,
        takenAt: Date.now(),
      })
    }
  }

  async revert(uri: vscode.Uri): Promise<'reverted' | 'conflict' | 'no-snapshot'> {
    const key = uri.toString()
    const snapshot = this.snapshots.get(key)
    if (!snapshot) return 'no-snapshot'

    let currentMtime: number
    try {
      const stat = await fs.stat(uri.fsPath)
      currentMtime = stat.mtimeMs
    } catch {
      currentMtime = 0
    }

    if (currentMtime > snapshot.mtimeMs + 1000) {
      // File modified after AI write — show diff preview, let user decide
      const originalUri = uri.with({ scheme: 'untitled', path: uri.fsPath + '.original' })
      const edit = new vscode.WorkspaceEdit()
      edit.insert(originalUri, new vscode.Position(0, 0), snapshot.content)
      await vscode.workspace.applyEdit(edit)
      await vscode.commands.executeCommand(
        'vscode.diff',
        uri,
        originalUri,
        `Revert: ${uri.fsPath} (current vs snapshot)`,
      )
      return 'conflict'
    }

    await fs.writeFile(uri.fsPath, snapshot.content, 'utf-8')
    this.snapshots.delete(key)
    return 'reverted'
  }

  /** Returns the snapshot content for a URI, or undefined if no snapshot exists. */
  getContent(uri: vscode.Uri): string | undefined {
    return this.snapshots.get(uri.toString())?.content
  }

  clear(): void {
    this.snapshots.clear()
  }
}
