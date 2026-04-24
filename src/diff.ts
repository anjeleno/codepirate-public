import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { SnapshotCache } from './cache'
import type { FileChange } from './types'

// ─── File block parser ────────────────────────────────────────────────────────
// Detects code blocks with file paths from AI response text.
// Supports three path annotation formats:
//   1. First-line comment: // path: src/foo.ts   or   # path: src/foo.ts
//   2. Language tag with path: ```typescript:src/foo.ts
//   3. Bold text immediately before block: **src/foo.ts**
//
// Within a block, if <<<<<<< SEARCH markers are found, the block is treated as
// one or more SEARCH/REPLACE hunks (targeted edits). Otherwise it's a full
// file replacement. Full-file blocks deduplicate by path; hunks do not.

const CODE_BLOCK_RE =
  /```(?:([\w.-]+)(?::([^\n`]+))?)?\n([\s\S]*?)```/g
const PATH_COMMENT_RE = /^(?:\/\/|#)\s*(?:path:|file:)?\s*([^\s]+\.[a-zA-Z]+)/

// Matches one SEARCH/REPLACE hunk within a code block
const HUNK_RE = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g

export function parseFileChanges(responseText: string): FileChange[] {
  const changes: FileChange[] = []
  const fullFileSeen = new Set<string>() // dedup full-file writes only

  // Find bold path lines before blocks
  const boldPathMap = new Map<number, string>()
  const boldRe = /\*\*([^*\n]+\.[a-zA-Z]+)\*\*/g
  let boldMatch: RegExpExecArray | null
  while ((boldMatch = boldRe.exec(responseText)) !== null) {
    boldPathMap.set(boldMatch.index, boldMatch[1])
  }

  let blockMatch: RegExpExecArray | null
  CODE_BLOCK_RE.lastIndex = 0
  while ((blockMatch = CODE_BLOCK_RE.exec(responseText)) !== null) {
    const langTag = blockMatch[1] ?? ''
    const inlinePathFromTag = blockMatch[2]?.trim() ?? ''
    const blockContent = blockMatch[3] ?? ''
    const blockStart = blockMatch.index

    let filePath: string | null = null

    // Priority 1: inline path from language tag (```ts:src/foo.ts)
    if (inlinePathFromTag) {
      filePath = inlinePathFromTag
    }

    // Priority 2: first line comment
    if (!filePath) {
      const firstLine = blockContent.split('\n')[0]
      const commentMatch = PATH_COMMENT_RE.exec(firstLine)
      if (commentMatch) {
        filePath = commentMatch[1]
      }
    }

    // Priority 3: bold path in text before this block (within 150 chars)
    if (!filePath) {
      for (const [boldIndex, boldPath] of boldPathMap) {
        if (boldIndex < blockStart && blockStart - boldIndex < 150) {
          filePath = boldPath
          break
        }
      }
    }

    if (!filePath) continue

    // Strip the path comment from the content if we extracted it that way
    let content = blockContent
    if (PATH_COMMENT_RE.test(content.split('\n')[0])) {
      content = content.split('\n').slice(1).join('\n')
    }

    // Ignore obviously non-file blocks (too short, shell/text languages)
    if (content.trim().length < 10) continue
    if (['bash', 'sh', 'shell', 'zsh', 'fish', 'console', 'text', 'plain'].includes(langTag)) continue

    // Check for SEARCH/REPLACE hunks — these are targeted edits
    if (content.includes('<<<<<<< SEARCH')) {
      HUNK_RE.lastIndex = 0
      let hunkMatch: RegExpExecArray | null
      while ((hunkMatch = HUNK_RE.exec(content)) !== null) {
        const search = hunkMatch[1] ?? ''
        const replacement = hunkMatch[2] ?? ''
        // Allow multiple hunks per file — no deduplication for search/replace
        changes.push({ path: filePath, search, content: replacement })
      }
      continue
    }

    // Full file replacement — deduplicate by path
    if (fullFileSeen.has(filePath)) continue
    fullFileSeen.add(filePath)
    changes.push({ path: filePath, content: content.trimEnd() })
  }

  return changes
}

// ─── Diff manager ─────────────────────────────────────────────────────────────

export class DiffManager {
  private pendingChanges: FileChange[] = []
  private snapshotCache: SnapshotCache
  /** Temp files written for diff preview — cleaned up on apply/reject */
  private tempProposedFiles: string[] = []

  constructor(snapshotCache: SnapshotCache) {
    this.snapshotCache = snapshotCache
  }

  setPendingChanges(changes: FileChange[]): void {
    this.pendingChanges = changes
  }

  getPendingChanges(): FileChange[] {
    return this.pendingChanges
  }

  hasPendingChanges(): boolean {
    return this.pendingChanges.length > 0
  }

  // ─── Preview: open VS Code diff for each changed file ──────────────────────
  // Groups hunks by file, computes proposed content, writes to a temp file,
  // and opens vscode.diff so the user sees exactly what changed (green/red).
  async previewChanges(): Promise<void> {
    await this.cleanup() // clear any previous temp files first

    const folders = vscode.workspace.workspaceFolders
    if (!folders) return

    const root = folders[0].uri.fsPath

    // Group changes by absolute path (preserving order)
    const order: string[] = []
    const byPath = new Map<string, FileChange[]>()

    for (const change of this.pendingChanges) {
      const abs = path.isAbsolute(change.path) ? change.path : path.join(root, change.path)
      if (!byPath.has(abs)) {
        order.push(abs)
        byPath.set(abs, [])
      }
      byPath.get(abs)!.push(change)
    }

    for (const abs of order) {
      const changes = byPath.get(abs)!
      const currentUri = vscode.Uri.file(abs)

      // Compute proposed content
      let proposed: string
      const fullChange = [...changes].reverse().find(c => c.search === undefined)

      if (fullChange) {
        proposed = fullChange.content
      } else {
        try {
          proposed = await fs.readFile(abs, 'utf-8')
        } catch {
          proposed = ''
        }
        for (const change of changes) {
          proposed = proposed.replace(change.search!, change.content)
        }
      }

      // Write to OS temp dir — doesn't pollute the workspace
      const tmpPath = path.join(
        os.tmpdir(),
        `cp-proposed-${Date.now()}-${path.basename(abs)}`,
      )
      await fs.writeFile(tmpPath, proposed, 'utf-8')
      this.tempProposedFiles.push(tmpPath)

      await vscode.commands.executeCommand(
        'vscode.diff',
        currentUri,
        vscode.Uri.file(tmpPath),
        `Code Pirate ↔ ${path.basename(abs)}`,
      )
    }
  }

  // ─── Apply: write changes to disk ──────────────────────────────────────────
  // For search/replace hunks: reads current file, applies each hunk in order.
  // For full-file replacements: overwrites directly.
  async applyChanges(): Promise<{ applied: string[]; failed: string[] }> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders) return { applied: [], failed: [] }

    const root = folders[0].uri.fsPath
    const applied: string[] = []
    const failed: string[] = []

    // Group by absolute path (preserving order of first occurrence)
    const order: string[] = []
    const byPath = new Map<string, { relPath: string; changes: FileChange[] }>()

    for (const change of this.pendingChanges) {
      const abs = path.isAbsolute(change.path) ? change.path : path.join(root, change.path)
      if (!byPath.has(abs)) {
        order.push(abs)
        byPath.set(abs, { relPath: change.path, changes: [] })
      }
      byPath.get(abs)!.changes.push(change)
    }

    for (const abs of order) {
      const { relPath, changes } = byPath.get(abs)!
      const uri = vscode.Uri.file(abs)

      try {
        // Snapshot before modifying (enables undo)
        await this.snapshotCache.take(uri)

        const fullChange = [...changes].reverse().find(c => c.search === undefined)

        if (fullChange) {
          // Full file replacement
          await fs.mkdir(path.dirname(abs), { recursive: true })
          await fs.writeFile(abs, fullChange.content, 'utf-8')
          applied.push(relPath)
        } else {
          // Search/replace hunks — apply sequentially
          let content: string
          try {
            content = await fs.readFile(abs, 'utf-8')
          } catch {
            failed.push(`${relPath}: file not found`)
            continue
          }

          let ok = true
          for (const change of changes) {
            if (!content.includes(change.search!)) {
              failed.push(`${relPath}: search text not found`)
              ok = false
              break
            }
            content = content.replace(change.search!, change.content)
          }

          if (ok) {
            await fs.writeFile(abs, content, 'utf-8')
            applied.push(relPath)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failed.push(`${relPath}: ${msg}`)
      }
    }

    this.pendingChanges = []
    await this.cleanup()
    return { applied, failed }
  }

  clearPending(): void {
    this.pendingChanges = []
    void this.cleanup()
  }

  /** Remove temp proposed files written for diff preview */
  async cleanup(): Promise<void> {
    for (const tmpPath of this.tempProposedFiles) {
      await fs.rm(tmpPath, { force: true }).catch(() => {})
    }
    this.tempProposedFiles = []
  }
}
