import * as vscode from 'vscode'
import { routeRequest, parseStream } from './router'
import { buildCompletionOptions } from './context'
import type { RouterConfig } from './types'

// ─── Inline ghost text completions ───────────────────────────────────────────

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private abortController: AbortController | null = null
  private readonly debounceMs = 300

  constructor(private getConfig: () => Promise<RouterConfig | null>) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | null> {
    // Only trigger on explicit invocation or automatic (not after accepting)
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      // Only trigger if line has meaningful content
      const lineText = document.lineAt(position.line).text.trimEnd()
      if (lineText.length < 2) return null
    }

    const config = await this.getConfig()
    if (!config) return null

    // Cancel any in-flight request
    this.abortController?.abort()

    // Debounce
    if (this.debounceTimer) clearTimeout(this.debounceTimer)

    return new Promise<vscode.InlineCompletionList | null>((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) {
          resolve(null)
          return
        }

        this.abortController = new AbortController()
        token.onCancellationRequested(() => this.abortController?.abort())

        try {
          const offset = document.offsetAt(position)
          const fullText = document.getText()
          const prefix = fullText.slice(0, offset)
          const suffix = fullText.slice(offset)

          const options = await buildCompletionOptions({
            prefix,
            suffix,
            languageId: document.languageId,
            signal: this.abortController.signal,
          })

          const response = await routeRequest(config, options)
          let completion = ''

          for await (const event of parseStream(response, config.provider)) {
            if (token.isCancellationRequested) break
            if (event.type === 'text') {
              completion += event.chunk
            }
          }

          completion = completion.trim()
          if (!completion) {
            resolve(null)
            return
          }

          // Strip wrapping code fences if the model returned them
          completion = stripCodeFences(completion)

          resolve(
            new vscode.InlineCompletionList([
              new vscode.InlineCompletionItem(completion),
            ]),
          )
        } catch {
          // AbortError or network error — fail silently
          resolve(null)
        }
      }, this.debounceMs)
    })
  }
}

function stripCodeFences(text: string): string {
  const fenceRe = /^```[\w]*\n?([\s\S]*?)```\s*$/
  const match = fenceRe.exec(text.trim())
  return match ? match[1].trimEnd() : text
}
