// ─────────────────────────────────────────────────────────────────────────────
// DEPRECATED — Legacy markdown-parsing diff engine
// ─────────────────────────────────────────────────────────────────────────────
//
// This module is the FALLBACK file-editing path for:
//   • anthropic-direct (uses a different tool schema, not yet adapted)
//   • ollama / lmstudio (tool support is model-dependent; too fragile for v1)
//
// For all other providers (openrouter, groq, together, mistral, gemini, custom)
// Code Pirate now uses structured tool calling via src/tools.ts + the agent
// loop in sidebar.ts.  The model calls read_file / str_replace / write_file
// directly as JSON function calls; the extension executes them via
// vscode.workspace.applyEdit (WorkspaceEdit) instead of fs.writeFile.
//
// DO NOT DELETE this file.  It is still required for the fallback path.
// DO NOT add new features here.  All new file-editing work goes into tools.ts.
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as path from 'path'
import { SnapshotCache } from './cache'
import { resolvePath } from './tools'
import type { FileChange } from './types'

// ─── File block parser ────────────────────────────────────────────────────────
// Detects code blocks with file paths from AI response text.
// Supports four path annotation formats:
//   1. First-line comment: // path: src/foo.ts   or   # path: src/foo.ts
//   2. Language tag with path: ```typescript:src/foo.ts
//   3. Bold text immediately before block: **src/foo.ts**
//   4. insert-after directive: // insert-after: 21  (inserts after line 21, 1-based)
//
// Within a block, if <<<<<<< SEARCH markers are found, the block is treated as
// one or more SEARCH/REPLACE hunks (targeted edits). Otherwise it's a full
// file replacement. Full-file blocks deduplicate by path; hunks do not.

const CODE_BLOCK_RE =
  /```(?:([\w.-]+)(?::([^\n`]+))?)?\n([\s\S]*?)```/g
const PATH_COMMENT_RE = /^(?:\/\/|#)\s*(?:path:|file:)?\s*([^\s]+\.[a-zA-Z]+)/
const INSERT_AFTER_RE = /^(?:\/\/|#)\s*insert-after:\s*(\d+)/i

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

    // Check for insert-after directive on the first remaining content line
    const insertMatch = INSERT_AFTER_RE.exec(content.split('\n')[0])
    if (insertMatch) {
      const lineNum = parseInt(insertMatch[1], 10)
      const insertContent = content.split('\n').slice(1).join('\n')
      changes.push({ path: filePath, content: insertContent, insertAfterLine: lineNum })
      continue
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
      const abs = resolvePath(change.path, root)
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
      const fullChange = [...changes].reverse().find(c => c.search === undefined && c.insertAfterLine === undefined)

      if (fullChange) {
        proposed = fullChange.content
      } else {
        try {
          proposed = await fs.readFile(abs, 'utf-8')
        } catch {
          proposed = ''
        }
        for (const change of changes) {
          if (change.insertAfterLine !== undefined) {
            // Line-number based insertion — split content into lines before splicing
            // to avoid double-newlines at the boundary when content is multi-line.
            const lines = proposed.split('\n')
            const insertAt = Math.min(change.insertAfterLine, lines.length)
            lines.splice(insertAt, 0, ...change.content.split('\n'))
            proposed = lines.join('\n')
          } else if (proposed.includes(change.search!)) {
            proposed = proposed.replace(change.search!, change.content)
          } else {
            // SEARCH text didn't match — inject a visible marker so the diff
            // view shows a red line rather than silently displaying no changes.
            const preview = change.search!.split('\n')[0].slice(0, 80)
            proposed = `// [Code Pirate] SEARCH NOT MATCHED — expected to find:\n// ${preview}\n\n` + proposed
          }
        }
      }

      // Write proposed content to OS temp dir — doesn't pollute the workspace
      const tmpPath = path.join(
        os.tmpdir(),
        `cp-proposed-${Date.now()}-${path.basename(abs)}`,
      )
      await fs.writeFile(tmpPath, proposed, 'utf-8')
      this.tempProposedFiles.push(tmpPath)

      // For new files (original doesn't exist on disk), write an empty temp file
      // as the left side of the diff. Using a non-existent URI on the left causes
      // VS Code to throw "the editor could not be opened because the file could
      // not be found" — even on SSH Remote where the error is especially opaque.
      let leftUri: vscode.Uri
      try {
        await fs.access(abs)
        leftUri = currentUri
      } catch {
        // File doesn't exist yet — use an empty temp file as the baseline
        const emptyPath = path.join(os.tmpdir(), `cp-empty-${Date.now()}-${path.basename(abs)}`)
        await fs.writeFile(emptyPath, '', 'utf-8')
        this.tempProposedFiles.push(emptyPath)
        leftUri = vscode.Uri.file(emptyPath)
      }

      await vscode.commands.executeCommand(
        'vscode.diff',
        leftUri,
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
      const abs = resolvePath(change.path, root)
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

        const fullChange = [...changes].reverse().find(c => c.search === undefined && c.insertAfterLine === undefined)

        if (fullChange) {
          // Full file replacement
          await fs.mkdir(path.dirname(abs), { recursive: true })
          await fs.writeFile(abs, fullChange.content, 'utf-8')
          applied.push(relPath)
        } else {
          // Search/replace hunks and/or insert-after directives — apply sequentially
          let content: string
          try {
            content = await fs.readFile(abs, 'utf-8')
          } catch {
            failed.push(`${relPath}: file not found`)
            continue
          }

          let ok = true
          for (const change of changes) {
            if (change.insertAfterLine !== undefined) {
              // Line-number based insertion — split into lines before splicing.
              const lines = content.split('\n')
              const insertAt = Math.min(change.insertAfterLine, lines.length)
              lines.splice(insertAt, 0, ...change.content.split('\n'))
              content = lines.join('\n')
            } else {
              if (!content.includes(change.search!)) {
                const preview = change.search!.split('\n')[0].slice(0, 80)
                failed.push(`${relPath}: SEARCH text not found in file — first line was: "${preview}"`)
                ok = false
                break
              }
              content = content.replace(change.search!, change.content)
            }
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
