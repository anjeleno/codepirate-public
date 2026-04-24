import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as path from 'path'
import { estimateTokens } from './budget'

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.turbo',
])
const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.mp4', '.mp3', '.wav', '.pdf', '.zip', '.tar', '.gz',
  '.lock', '.log', '.map', '.min.js', '.min.css',
])
const MAX_FILE_TOKENS = 2000
const MAX_TOTAL_TOKENS = 20000

interface IndexedFile {
  relativePath: string
  content: string
  tokens: number
  score: number
}

export class WorkspaceIndexer {
  // Build a token-weighted manifest of the most relevant workspace files
  async buildContext(
    currentFilePath?: string,
    model = 'anthropic/claude-opus-4',
  ): Promise<string> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return ''

    const rootPath = folders[0].uri.fsPath
    const files = await this.collectFiles(rootPath)
    const indexed = await this.indexFiles(files, rootPath, currentFilePath, model)

    // Sort by score descending, then pack until token budget exhausted
    indexed.sort((a, b) => b.score - a.score)

    const packed: IndexedFile[] = []
    let total = 0
    for (const f of indexed) {
      if (total + f.tokens > MAX_TOTAL_TOKENS) break
      packed.push(f)
      total += f.tokens
    }

    if (packed.length === 0) return ''

    const sections = packed.map(
      (f) => `### ${f.relativePath}\n\`\`\`\n${f.content}\n\`\`\``,
    )
    return `[Workspace Context — ${packed.length} files, ~${total} tokens]\n\n${sections.join('\n\n')}`
  }

  private async collectFiles(rootPath: string): Promise<string[]> {
    const results: string[] = []
    await this.walk(rootPath, rootPath, results)
    return results
  }

  private async walk(dir: string, root: string, results: string[]): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return
    }

    for (const entry of entries) {
      const entryName = String(entry.name)
      const fullPath = path.join(dir, entryName)
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entryName) && !entryName.startsWith('.')) {
          await this.walk(fullPath, root, results)
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entryName).toLowerCase()
        if (!IGNORE_EXTENSIONS.has(ext)) {
          results.push(fullPath)
        }
      }
    }
  }

  private async indexFiles(
    filePaths: string[],
    rootPath: string,
    currentFilePath: string | undefined,
    model: string,
  ): Promise<IndexedFile[]> {
    const currentDir = currentFilePath ? path.dirname(currentFilePath) : null
    const results: IndexedFile[] = []

    await Promise.all(
      filePaths.map(async (fullPath) => {
        try {
          const stat = await fs.stat(fullPath)
          if (stat.size > 100_000) return // Skip files > 100KB

          let content = await fs.readFile(fullPath, 'utf-8')
          const tokens = estimateTokens(content, model)

          // Truncate if too large
          if (tokens > MAX_FILE_TOKENS) {
            const ratio = MAX_FILE_TOKENS / tokens
            content = content.slice(0, Math.floor(content.length * ratio)) + '\n// [truncated]'
          }

          const relativePath = path.relative(rootPath, fullPath)
          const score = this.scoreFile(fullPath, relativePath, stat.mtimeMs, currentDir)

          results.push({ relativePath, content, tokens: Math.min(tokens, MAX_FILE_TOKENS), score })
        } catch {
          // Skip unreadable files
        }
      }),
    )

    return results
  }

  // Estimate how many tokens the workspace context would consume for this model.
  // Runs the same scoring/packing logic as buildContext but skips reading file
  // content — uses only file sizes for the estimate, making it fast enough to
  // call on @workspace toggle without noticeable delay.
  async estimateTokenCount(
    currentFilePath?: string,
    model = 'anthropic/claude-opus-4',
  ): Promise<number> {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return 0

    const rootPath = folders[0].uri.fsPath
    const files = await this.collectFiles(rootPath)
    const indexed = await this.indexFiles(files, rootPath, currentFilePath, model)

    indexed.sort((a, b) => b.score - a.score)

    let total = 0
    for (const f of indexed) {
      if (total + f.tokens > MAX_TOTAL_TOKENS) break
      total += f.tokens
    }

    return total
  }

  private scoreFile(
    fullPath: string,
    relativePath: string,
    mtimeMs: number,
    currentDir: string | null,
  ): number {
    let score = 0

    // Recency bonus (files modified in last hour score highest)
    const ageMs = Date.now() - mtimeMs
    if (ageMs < 3_600_000) score += 10
    else if (ageMs < 86_400_000) score += 5

    // Same directory as current file
    if (currentDir && path.dirname(fullPath) === currentDir) score += 8

    // Depth penalty — prefer shallower files
    const depth = relativePath.split(path.sep).length
    score -= depth

    // Config/entrypoint bonus
    const name = path.basename(fullPath)
    if (/^(index|main|app|extension)\.[a-z]+$/.test(name)) score += 3
    if (name.endsWith('.config.ts') || name.endsWith('.config.js')) score += 2

    // Type definition files are high value for context
    if (name === 'types.ts' || name === 'types.d.ts') score += 4

    return score
  }
}
