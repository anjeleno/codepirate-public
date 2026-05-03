import * as vscode from 'vscode'
import { getRules } from './rules'
import { getSystemPrompt } from './personas'
import { WorkspaceIndexer } from './indexer'
import type { ChatMessage, Persona, RequestOptions } from './types'
import type { Phase } from './phaseDetector'

const indexer = new WorkspaceIndexer()

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
