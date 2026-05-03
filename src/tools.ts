import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { SnapshotCache } from './cache'
import type { ToolDefinition, ToolCall } from './types'

// ─── Path resolution ──────────────────────────────────────────────────────────
// Canonical path resolver for all file operations — expands ~/... to the OS
// home directory, handles both absolute and workspace-relative paths.
// Exported so diff.ts can import it and stay DRY.

export function resolvePath(filePath: string, workspaceRoot: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(2))
  }
  return path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath)
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
// JSON Schema objects sent to the model. The model calls these by name and
// Code Pirate executes them — no markdown parsing, no fragile text matching.
// This is the OpenAI function-calling standard, supported by every provider
// except Anthropic Direct (which uses a different schema — see Decision #37).

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read the full content of a file. Always call this before editing so you have the exact current content. Returns the file text, or an ERROR string if the file cannot be found.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path (e.g. src/index.ts), absolute path, or ~/... path.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create a new file or fully overwrite an existing file with the given content. For editing an existing file, prefer str_replace instead — it is more precise and produces a smaller undo footprint. Use write_file only when creating a new file or replacing an entire file intentionally.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative, absolute, or ~/... path.',
        },
        content: {
          type: 'string',
          description: 'Full file content to write.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'str_replace',
    description:
      'Replace an exact string in a file with new text. Call read_file first to obtain the exact current content. old_str must match verbatim — including all whitespace, indentation, and surrounding lines. Include at least 2–3 lines of context before and after the changed lines for a unique match. Returns an ERROR string if old_str is not found.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative, absolute, or ~/... path.',
        },
        old_str: {
          type: 'string',
          description:
            'Exact text to replace, including surrounding context lines. Must match verbatim.',
        },
        new_str: {
          type: 'string',
          description: 'Replacement text.',
        },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'insert_at_line',
    description:
      'Insert new content after a specific 1-based line number without needing a verbatim search anchor. Use this when inserting entirely new content at a position where there is no stable anchor text, or when inserting after a blank line or at the end of a file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative, absolute, or ~/... path.',
        },
        line: {
          type: 'number',
          description:
            '1-based line number to insert after. Use 0 to insert at the top of the file.',
        },
        content: {
          type: 'string',
          description: 'Content to insert. May be multi-line.',
        },
      },
      required: ['path', 'line', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the files and subdirectories in a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Directory path. Use "." for the workspace root.',
        },
      },
      required: ['path'],
    },
  },
]

// ─── Tool execution ───────────────────────────────────────────────────────────
// All file mutations go through vscode.workspace.applyEdit (WorkspaceEdit).
// This gives us:
//   • Native undo/redo via Ctrl+Z — every edit is one step in VS Code's history
//   • In-memory document model — subsequent read_file calls see pending edits
//     even before the file is saved to disk
//   • CRLF normalization, encoding, and language server integration
//   • Works identically in local, SSH Remote, WSL2, and container environments
//
// File mutations snapshot the pre-change content via SnapshotCache before the
// first write per file per agent loop, for the Revert History panel.

export async function executeTool(
  call: ToolCall,
  snapshotCache: SnapshotCache,
  snapshotted: Set<string>,  // tracks which absolute paths are already snapshotted this loop
): Promise<string> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
  const args = call.args

  switch (call.name) {
    case 'read_file': {
      const abs = resolvePath(String(args.path), root)
      const uri = vscode.Uri.file(abs)
      try {
        // openTextDocument returns the in-memory version — sees any unsaved edits
        // from earlier tool calls in the same agent round before disk writes.
        const doc = await vscode.workspace.openTextDocument(uri)
        return doc.getText()
      } catch {
        return `ERROR: File not found: ${args.path}`
      }
    }

    case 'write_file': {
      const abs = resolvePath(String(args.path), root)
      const content = String(args.content)
      const uri = vscode.Uri.file(abs)
      try {
        let exists = false
        try {
          await vscode.workspace.fs.stat(uri)
          exists = true
        } catch { /* new file */ }

        const edit = new vscode.WorkspaceEdit()

        if (exists) {
          if (!snapshotted.has(abs)) {
            await snapshotCache.take(uri)
            snapshotted.add(abs)
          }
          const doc = await vscode.workspace.openTextDocument(uri)
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length),
          )
          edit.replace(uri, fullRange, content)
        } else {
          // New file — create parent directory then create via WorkspaceEdit
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(path.dirname(abs)),
          )
          const encoded = new TextEncoder().encode(content)
          edit.createFile(uri, { contents: encoded })
        }

        const ok = await vscode.workspace.applyEdit(edit)
        if (!ok) throw new Error('WorkspaceEdit.applyEdit returned false')
        const lines = content.split('\n').length
        return `OK: ${args.path} written (${lines} line${lines === 1 ? '' : 's'})`
      } catch (err) {
        return `ERROR: Could not write ${args.path}: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'str_replace': {
      const abs = resolvePath(String(args.path), root)
      const oldStr = String(args.old_str)
      const newStr = String(args.new_str)
      const uri = vscode.Uri.file(abs)
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const text = doc.getText()
        const idx = text.indexOf(oldStr)
        if (idx === -1) {
          const preview = oldStr.split('\n')[0].slice(0, 80)
          return (
            `ERROR: old_str not found in ${args.path}. First line searched: "${preview}". ` +
            `Call read_file to verify the current content and retry with an exact match.`
          )
        }
        if (!snapshotted.has(abs)) {
          await snapshotCache.take(uri)
          snapshotted.add(abs)
        }
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(doc.positionAt(idx), doc.positionAt(idx + oldStr.length)), newStr)
        const ok = await vscode.workspace.applyEdit(edit)
        if (!ok) throw new Error('WorkspaceEdit.applyEdit returned false')
        const delta = newStr.split('\n').length - oldStr.split('\n').length
        return `OK: ${args.path} edited (${delta >= 0 ? '+' : ''}${delta} lines)`
      } catch (err) {
        return `ERROR: str_replace failed on ${args.path}: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'insert_at_line': {
      const abs = resolvePath(String(args.path), root)
      const lineNum = Number(args.line)
      const content = String(args.content)
      const uri = vscode.Uri.file(abs)
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        if (!snapshotted.has(abs)) {
          await snapshotCache.take(uri)
          snapshotted.add(abs)
        }
        // Split → splice → join — same approach as the legacy diff.ts insert-after
        // logic, but the actual write goes through WorkspaceEdit for undo support.
        const text = doc.getText()
        const lines = text.split('\n')
        const insertAt = Math.min(Math.max(0, lineNum), lines.length)
        lines.splice(insertAt, 0, ...content.split('\n'))
        const newContent = lines.join('\n')
        const edit = new vscode.WorkspaceEdit()
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length))
        edit.replace(uri, fullRange, newContent)
        const ok = await vscode.workspace.applyEdit(edit)
        if (!ok) throw new Error('WorkspaceEdit.applyEdit returned false')
        const inserted = content.split('\n').length
        return `OK: ${args.path} — inserted ${inserted} line${inserted === 1 ? '' : 's'} after line ${lineNum}`
      } catch (err) {
        return `ERROR: insert_at_line failed on ${args.path}: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'list_dir': {
      const abs = resolvePath(String(args.path === '.' ? root : String(args.path)), root)
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true })
        const lines = entries
          .map(e => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
        return lines.join('\n') || '(empty directory)'
      } catch (err) {
        return `ERROR: Cannot list ${args.path}: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    default:
      return `ERROR: Unknown tool: ${call.name}`
  }
}
