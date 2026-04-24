import * as vscode from 'vscode'
import { routeRequest, parseStream } from './router'
import type { RouterConfig } from './types'

// ─── Ctrl+I inline chat ───────────────────────────────────────────────────────

export async function runInlineChat(
  getConfig: () => Promise<RouterConfig | null>,
): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showErrorMessage('Code Pirate: Open a file to use inline chat.')
    return
  }

  const config = await getConfig()
  if (!config) {
    vscode.window.showErrorMessage(
      'Code Pirate: Configure your API key first (open the Code Pirate sidebar).',
    )
    return
  }

  const selection = editor.selection
  const hasSelection = !selection.isEmpty
  const selectedText = hasSelection ? editor.document.getText(selection) : ''

  const instruction = await vscode.window.showInputBox({
    prompt: hasSelection
      ? `What would you like to do with this ${editor.document.languageId} code?`
      : 'Ask Code Pirate anything about this file…',
    placeHolder: hasSelection
      ? 'Refactor this, add error handling, convert to async…'
      : 'Explain this file, add types, fix the bug on line 42…',
  })

  if (!instruction) return

  const abortController = new AbortController()

  // Build a targeted system prompt
  const systemPrompt =
    'You are a precise code editor. The user will provide a code selection and an instruction. ' +
    'Respond with ONLY the replacement code — no explanations, no preamble, no trailing commentary. ' +
    'Preserve the original indentation level. Output a complete, correct code block.'

  const userContent = hasSelection
    ? `Language: ${editor.document.languageId}\n\nSelected code:\n\`\`\`\n${selectedText}\n\`\`\`\n\nInstruction: ${instruction}`
    : `Language: ${editor.document.languageId}\n\nFile:\n\`\`\`\n${editor.document.getText().slice(0, 8000)}\n\`\`\`\n\nInstruction: ${instruction}`

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Code Pirate thinking…',
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => abortController.abort())

      try {
        const response = await routeRequest(config, {
          messages: [{ role: 'user', content: userContent }],
          systemPrompt,
          maxTokens: 4096,
          thinkingBudget: 'off',
          stream: true,
          signal: abortController.signal,
        })

        let result = ''
        for await (const event of parseStream(response, config.provider)) {
          if (token.isCancellationRequested) break
          if (event.type === 'text') result += event.chunk
        }

        result = result.trim()
        if (!result) return

        // Strip outer code fences if present
        const fenceRe = /^```[\w]*\n?([\s\S]*?)```\s*$/
        const fenceMatch = fenceRe.exec(result)
        const cleanResult = fenceMatch ? fenceMatch[1].trimEnd() : result

        if (hasSelection) {
          // Replace the selection with the AI result
          await editor.edit((editBuilder) => {
            editBuilder.replace(selection, cleanResult)
          })
        } else {
          // No selection — show result in a new untitled document
          const doc = await vscode.workspace.openTextDocument({
            content: cleanResult,
            language: editor.document.languageId,
          })
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside)
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          vscode.window.showErrorMessage(`Code Pirate: ${err.message}`)
        }
      }
    },
  )
}

// ─── Terminal error explainer ─────────────────────────────────────────────────

export async function explainTerminalError(
  getConfig: () => Promise<RouterConfig | null>,
): Promise<void> {
  const config = await getConfig()
  if (!config) {
    vscode.window.showErrorMessage(
      'Code Pirate: Configure your API key first.',
    )
    return
  }

  const errorText = await vscode.window.showInputBox({
    prompt: 'Paste the terminal error or stack trace',
    placeHolder: 'TypeError: Cannot read properties of undefined…',
  })
  if (!errorText) return

  // Open sidebar and send as a chat message — handled by sidebar via command
  await vscode.commands.executeCommand('codePirate.openSidebar')
  await vscode.commands.executeCommand('codePirate._sendTerminalError', errorText)
}

// ─── Commit message generator ─────────────────────────────────────────────────

export async function generateCommitMessage(
  getConfig: () => Promise<RouterConfig | null>,
): Promise<void> {
  const config = await getConfig()
  if (!config) {
    vscode.window.showErrorMessage('Code Pirate: Configure your API key first.')
    return
  }

  const abortController = new AbortController()

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Code Pirate: Generating commit message…',
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => abortController.abort())

      try {
        // Get git diff
        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports
        const git = gitExtension?.getAPI(1)
        const repo = git?.repositories?.[0]
        const diff: string = repo
          ? await repo.diff(true).catch(() => '') || await repo.diff().catch(() => '')
          : ''

        if (!diff) {
          vscode.window.showWarningMessage('Code Pirate: No staged changes found. Stage your changes first.')
          return
        }

        const systemPrompt =
          'You are a commit message generator. Given a git diff, produce a concise, conventional commit message. ' +
          'Format: <type>(<optional scope>): <description>\n\nOptional body with bullet points for significant changes.\n\n' +
          'Types: feat, fix, refactor, docs, style, test, chore. ' +
          'Keep the subject line under 72 characters. Output ONLY the commit message, no explanation.'

        const response = await routeRequest(config, {
          messages: [{ role: 'user', content: `Git diff:\n\`\`\`diff\n${diff.slice(0, 6000)}\n\`\`\`` }],
          systemPrompt,
          maxTokens: 256,
          thinkingBudget: 'off',
          stream: true,
          signal: abortController.signal,
        })

        let commitMsg = ''
        for await (const event of parseStream(response, config.provider)) {
          if (token.isCancellationRequested) break
          if (event.type === 'text') commitMsg += event.chunk
        }

        commitMsg = commitMsg.trim()
        if (!commitMsg) return

        // Populate the SCM input box
        if (repo) {
          repo.inputBox.value = commitMsg
          await vscode.commands.executeCommand('workbench.view.scm')
          vscode.window.showInformationMessage('Code Pirate: Commit message generated ✓')
        } else {
          // Fallback: copy to clipboard
          await vscode.env.clipboard.writeText(commitMsg)
          vscode.window.showInformationMessage('Code Pirate: Commit message copied to clipboard ✓')
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          vscode.window.showErrorMessage(`Code Pirate: ${err.message}`)
        }
      }
    },
  )
}
