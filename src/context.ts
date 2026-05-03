import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getRules } from './rules'
import { getSystemPrompt } from './personas'
import { WorkspaceIndexer } from './indexer'
import type { ChatMessage, Persona, RequestOptions } from './types'
import type { Phase } from './phaseDetector'

const indexer = new WorkspaceIndexer()

// Blueprint injection threshold: ~1,500 tokens (~6,000 chars).
// Under threshold → inject verbatim. Over threshold → inject summary + pointer.
const BLUEPRINT_INJECT_THRESHOLD_CHARS = 6_000

async function getBlueprintContext(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return ''

  const blueprintPath = path.join(folders[0].uri.fsPath, 'blueprint.md')
  let content: string
  try {
    content = await fs.readFile(blueprintPath, 'utf-8')
  } catch {
    return ''
  }

  if (content.length <= BLUEPRINT_INJECT_THRESHOLD_CHARS) {
    return `[Project Blueprint]\n${content}`
  }

  // Over threshold — extract Problem & Vision + MVP sections and add a pointer
  const problemMatch = content.match(/## Problem & Vision\n([\s\S]*?)(?=\n## |\n# |$)/)
  const mvpMatch = content.match(/## MVP[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/)
  const parts: string[] = ['[Project Blueprint — Summary]']
  if (problemMatch) parts.push(`## Problem & Vision\n${problemMatch[1].trim()}`)
  if (mvpMatch) parts.push(`## MVP\n${mvpMatch[1].trim()}`)
  parts.push(`*Full blueprint at \`blueprint.md\` — call \`read_file\` on it when making architectural decisions.*`)

  return parts.join('\n\n')
}

export async function buildRequestOptions(params: {
  messages: ChatMessage[]
  persona: Persona
  vaultContext: string
  includeWorkspace: boolean
  activeFileContent?: string
  attachedFilesContent?: string[]
  maxTokens?: number
  thinkingBudget?: RequestOptions['thinkingBudget']
  signal?: AbortSignal
  model?: string
  phase?: Phase
}): Promise<RequestOptions> {
  const rules = await getRules()
  const currentFile = vscode.window.activeTextEditor?.document.uri.fsPath

  const workspaceContext = params.includeWorkspace
    ? await indexer.buildContext(currentFile, params.model)
    : ''

  const systemParts: string[] = [getSystemPrompt(params.persona, params.model, params.phase)]

  if (rules) {
    systemParts.push(`[Project Rules]\n${rules}`)
  }

  // Inject blueprint.md into context for CORE (and continuation runs).
  // Skip during planner sessions — the planner is gathering information, not
  // referencing prior decisions.
  if (params.persona !== 'planner') {
    const blueprintContext = await getBlueprintContext()
    if (blueprintContext) {
      systemParts.push(blueprintContext)
    }
  }

  if (params.vaultContext) {
    systemParts.push(params.vaultContext)
  }

  if (workspaceContext) {
    systemParts.push(workspaceContext)
  }

  if (params.activeFileContent) {
    systemParts.push(params.activeFileContent)
  }

  if (params.attachedFilesContent?.length) {
    systemParts.push(params.attachedFilesContent.join('\n\n'))
  }

  return {
    messages: params.messages,
    systemPrompt: systemParts.join('\n\n---\n\n'),
    maxTokens: params.maxTokens ?? 8192,
    thinkingBudget: params.thinkingBudget ?? 'off',
    stream: true,
    signal: params.signal,
  }
}

// Build options for inline completions — lean context, no workspace indexing
export async function buildCompletionOptions(params: {
  prefix: string
  suffix: string
  languageId: string
  signal?: AbortSignal
}): Promise<RequestOptions> {
  const rules = await getRules()

  const systemParts = [
    'You are a precise code completion engine. Complete the code at the <CURSOR> marker. Output ONLY the completion text — no explanations, no markdown fences, no preamble. The output will be inserted directly into the editor.',
  ]
  if (rules) systemParts.push(`[Project Rules]\n${rules}`)

  const userContent =
    `Language: ${params.languageId}\n\n` +
    `[PREFIX]\n${params.prefix.slice(-2000)}\n[CURSOR]\n${params.suffix.slice(0, 500)}`

  return {
    messages: [{ role: 'user', content: userContent }],
    systemPrompt: systemParts.join('\n\n'),
    maxTokens: 200,
    thinkingBudget: 'off',
    stream: true,
    signal: params.signal,
  }
}
